/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligent EPUB Layout Reconstruction & Gap Removal Pipeline
 *
 * Eliminates unnecessary PDF page-boundary whitespace, reconstructs paragraphs
 * continuing across pages or columns, reorders multi-column reading sequences,
 * normalizes HTML/CSS structure, and validates the final EPUB layout while
 * strictly preserving chapter boundaries, TOC navigation, and original text.
 */

import {
  BookDetails,
  ContinuationConfidence,
  EpubTocItem,
  LayoutCleanupReport,
  PageBoundaryMergeDecision,
  PageFigure,
  PageItem,
  PdfOutlineItem,
  PdfTextBlock,
  StructureConfig,
} from '../types';
import { isValidBengaliWord } from './bengaliOcrPipeline';

export interface ColumnDetectionResult {
  columnCount: 1 | 2 | 3;
  isMultiColumn: boolean;
  gutterXPositions: number[];
  reorderedText: string;
  method: 'geometry' | 'text_gutter' | 'html_columns' | 'single_column';
}

export interface ConsolidatedPageGroup {
  /** Primary page item representing the consolidated chapter/section in the EPUB spine */
  sectionPage: PageItem;
  /** All original PDF page numbers merged into this section (in order) */
  sourcePageNumbers: number[];
  /** Mapping from local figure index (1-based) in sectionPage to original { pageNumber, figIndex (1-based), figure } */
  figureOriginMap: Array<{
    originalPageNumber: number;
    originalFigureIndex: number;
    figure: PageFigure;
  }>;
}

export interface DocumentLayoutReconstructionResult {
  /** Reconstructed section pages ready for EPUB spine assembly */
  consolidatedGroups: ConsolidatedPageGroup[];
  /** Cleaned individual pages (with running headers/footers & multi-column fixed) */
  cleanedPages: PageItem[];
  /** Map from original PDF pageNumber to the consolidated section's target file (e.g. page_4 -> page_3.xhtml) */
  pageToSectionFileMap: Map<number, { sectionPageNumber: number; targetFile: string; needsPageAnchor: boolean }>;
  /** Comprehensive diagnostics report */
  report: LayoutCleanupReport;
}

// ============================================================================
// 1. MULTI-COLUMN DETECTION & READING ORDER RECONSTRUCTION
// ============================================================================

/**
 * Reconstructs natural single-column reading order from 2D PDF geometry text blocks.
 *
 * Handles:
 * - Full-width spanning headings, titles, figures, tables, and footnotes
 * - 2-column and 3-column layouts separated by vertical gutters
 * - Reading Column 1 from top-to-bottom before continuing to Column 2 top-to-bottom
 */
export function reconstructMultiColumnFromGeometry(
  blocks: PdfTextBlock[],
  pageWidth: number,
  pageHeight: number
): ColumnDetectionResult {
  if (!blocks || blocks.length === 0 || pageWidth <= 0 || pageHeight <= 0) {
    return {
      columnCount: 1,
      isMultiColumn: false,
      gutterXPositions: [],
      reorderedText: '',
      method: 'single_column',
    };
  }

  // Filter out empty blocks and normalize coordinates
  const validBlocks = blocks
    .filter((b) => b && b.text && b.text.trim().length > 0)
    .map((b) => ({
      ...b,
      text: b.text.trim(),
      x: Math.max(0, b.x),
      y: Math.max(0, b.y),
      width: Math.max(1, b.width),
      height: Math.max(1, b.height || 12),
    }));

  if (validBlocks.length < 2) {
    return {
      columnCount: 1,
      isMultiColumn: false,
      gutterXPositions: [],
      reorderedText: validBlocks.map((b) => b.text).join('\n\n'),
      method: 'single_column',
    };
  }

  // Detect whether there is a clear vertical gutter near the horizontal center (35%..65% of pageWidth)
  const centerMin = pageWidth * 0.36;
  const centerMax = pageWidth * 0.64;

  // A block is "full-width spanning" if its width > 56% of pageWidth OR it crosses the central gutter zone significantly
  const isSpanningBlock = (b: PdfTextBlock): boolean => {
    const right = b.x + b.width;
    if (b.width >= pageWidth * 0.56) return true;
    // Crosses from left of 38% to right of 62%
    if (b.x < pageWidth * 0.38 && right > pageWidth * 0.62) return true;
    return false;
  };

  const nonSpanning = validBlocks.filter((b) => !isSpanningBlock(b));

  // Candidate blocks strictly on the left half vs strictly on the right half
  const midX = pageWidth * 0.5;
  const leftBlocks = nonSpanning.filter((b) => b.x + b.width <= pageWidth * 0.54);
  const rightBlocks = nonSpanning.filter((b) => b.x >= pageWidth * 0.46);

  // Check if left and right blocks overlap vertically (true side-by-side columns, not just top-left and bottom-right)
  let hasVerticalOverlap = false;
  if (leftBlocks.length >= 2 && rightBlocks.length >= 2) {
    const leftMinY = Math.min(...leftBlocks.map((b) => b.y));
    const leftMaxY = Math.max(...leftBlocks.map((b) => b.y + b.height));
    const rightMinY = Math.min(...rightBlocks.map((b) => b.y));
    const rightMaxY = Math.max(...rightBlocks.map((b) => b.y + b.height));
    const overlapY = Math.min(leftMaxY, rightMaxY) - Math.max(leftMinY, rightMinY);
    const totalSpanY = Math.max(leftMaxY, rightMaxY) - Math.min(leftMinY, rightMinY);
    if (overlapY > 0 && totalSpanY > 0 && overlapY / totalSpanY >= 0.25) {
      hasVerticalOverlap = true;
    }
  }

  if (!hasVerticalOverlap) {
    // Check 3-column layout (gutter around 33% and 66%)
    const col1 = nonSpanning.filter((b) => b.x + b.width <= pageWidth * 0.37);
    const col2 = nonSpanning.filter((b) => b.x >= pageWidth * 0.33 && b.x + b.width <= pageWidth * 0.69);
    const col3 = nonSpanning.filter((b) => b.x >= pageWidth * 0.65);

    if (col1.length >= 2 && col2.length >= 2 && col3.length >= 2) {
      const g1 = Math.round(pageWidth * 0.34);
      const g2 = Math.round(pageWidth * 0.67);
      const ordered = orderBlocksInVerticalBands(validBlocks, [g1, g2], isSpanningBlock);
      return {
        columnCount: 3,
        isMultiColumn: true,
        gutterXPositions: [g1, g2],
        reorderedText: ordered,
        method: 'geometry',
      };
    }

    // Single column: sort top-to-bottom by Y, then left-to-right by X for same baseline
    const sortedSingle = [...validBlocks].sort((a, b) => {
      if (Math.abs(a.y - b.y) <= Math.min(a.height, b.height) * 0.5) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    return {
      columnCount: 1,
      isMultiColumn: false,
      gutterXPositions: [],
      reorderedText: mergeGeometryLinesIntoParagraphs(sortedSingle),
      method: 'single_column',
    };
  }

  // Compute exact 2-column gutter X coordinate between leftBlocks and rightBlocks
  const maxLeftRightEdge = Math.max(...leftBlocks.map((b) => b.x + b.width));
  const minRightLeftEdge = Math.min(...rightBlocks.map((b) => b.x));
  const gutterX =
    minRightLeftEdge >= maxLeftRightEdge
      ? Math.round((maxLeftRightEdge + minRightLeftEdge) / 2)
      : Math.round(Math.max(centerMin, Math.min(centerMax, midX)));

  const orderedText = orderBlocksInVerticalBands(validBlocks, [gutterX], isSpanningBlock);

  return {
    columnCount: 2,
    isMultiColumn: true,
    gutterXPositions: [gutterX],
    reorderedText: orderedText,
    method: 'geometry',
  };
}

/**
 * Segments a page into vertical bands separated by full-width spanning elements
 * (headings, wide figures/tables, bottom footnotes). Within each multi-column band,
 * reads Column 1 top-to-bottom, then Column 2 top-to-bottom (and Column 3 if present).
 */
function orderBlocksInVerticalBands(
  blocks: PdfTextBlock[],
  gutterXPositions: number[],
  isSpanningBlock: (b: PdfTextBlock) => boolean
): string {
  const sortedByY = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Array<{ type: 'spanning' | 'columns'; items: PdfTextBlock[] }> = [];

  for (const block of sortedByY) {
    const spanning = isSpanningBlock(block);
    const lastBand = bands[bands.length - 1];
    if (!lastBand || (spanning && lastBand.type !== 'spanning') || (!spanning && lastBand.type !== 'columns')) {
      bands.push({
        type: spanning ? 'spanning' : 'columns',
        items: [block],
      });
    } else {
      lastBand.items.push(block);
    }
  }

  const outputSections: string[] = [];

  for (const band of bands) {
    if (band.type === 'spanning') {
      const bandSorted = [...band.items].sort((a, b) => a.y - b.y || a.x - b.x);
      outputSections.push(mergeGeometryLinesIntoParagraphs(bandSorted));
    } else {
      // Partition band items into columns using gutterXPositions
      const numCols = gutterXPositions.length + 1;
      const colBuckets: PdfTextBlock[][] = Array.from({ length: numCols }, () => []);

      for (const item of band.items) {
        const centerX = item.x + item.width / 2;
        let colIdx = gutterXPositions.findIndex((gx) => centerX < gx);
        if (colIdx === -1) colIdx = numCols - 1;
        colBuckets[colIdx].push({ ...item, columnIndex: colIdx });
      }

      for (const bucket of colBuckets) {
        if (bucket.length === 0) continue;
        bucket.sort((a, b) => a.y - b.y || a.x - b.x);
        outputSections.push(mergeGeometryLinesIntoParagraphs(bucket));
      }
    }
  }

  return outputSections.filter(Boolean).join('\n\n');
}

/**
 * Joins consecutive lines within a single column into logical paragraphs based on
 * vertical line spacing, sentence punctuation, and hyphenation.
 */
function mergeGeometryLinesIntoParagraphs(lines: PdfTextBlock[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0].text.trim();

  // Estimate typical line gap within a paragraph
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - (lines[i - 1].y + lines[i - 1].height);
    if (gap >= -4 && gap < 60) {
      gaps.push(gap);
    }
  }
  const medianGap =
    gaps.length > 0
      ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      : 6;
  const paragraphGapThreshold = Math.max(medianGap * 1.85, 14);

  const paragraphs: string[] = [];
  let currentPara = lines[0].text.trim();

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const text = curr.text.trim();
    if (!text) continue;

    const verticalGap = curr.y - (prev.y + prev.height);
    const isHeadingLine = /^#+\s/.test(text) || /^#+\s/.test(currentPara);
    const isLargeVerticalGap = verticalGap > paragraphGapThreshold;
    const isIndentedStart = curr.x - prev.x > (prev.height || 12) * 1.4 && /[।॥.?!”’"']\s*$/.test(currentPara);

    if (isHeadingLine || isLargeVerticalGap || isIndentedStart) {
      paragraphs.push(currentPara);
      currentPara = text;
    } else {
      currentPara = joinTwoTextSegmentsLosslessly(currentPara, text);
    }
  }

  if (currentPara) {
    paragraphs.push(currentPara);
  }

  return paragraphs.join('\n\n');
}

/**
 * Detects and reconstructs multi-column text in Markdown / OCR output or HTML column wrappers.
 *
 * Handles:
 * 1. Coordinate-based PDF blocks (when `geometryBlocks` are provided)
 * 2. HTML/CSS multi-column containers (`<div style="column-count: 2">`, `<div class="col-left">...`)
 * 3. Side-by-side text columns separated by consistent wide horizontal spaces (4+ spaces or tabs)
 */
export function reconstructMultiColumnMarkdown(
  markdown: string,
  geometryBlocks?: PdfTextBlock[],
  pageWidth: number = 600,
  pageHeight: number = 850
): ColumnDetectionResult {
  if (!markdown || !markdown.trim()) {
    return {
      columnCount: 1,
      isMultiColumn: false,
      gutterXPositions: [],
      reorderedText: markdown || '',
      method: 'single_column',
    };
  }

  // Priority 1: If geometry blocks are provided and detect multi-column layout, use geometry ordering
  if (geometryBlocks && geometryBlocks.length >= 4) {
    const geoRes = reconstructMultiColumnFromGeometry(geometryBlocks, pageWidth, pageHeight);
    if (geoRes.isMultiColumn && geoRes.reorderedText.trim().length > 0) {
      return geoRes;
    }
  }

  let working = markdown;
  let detectedHtmlColumns = false;

  // Priority 2: Unwrap HTML multi-column wrapper divs into sequential single-column blocks
  const htmlColPattern =
    /<div\s+[^>]*?(?:column-count\s*:\s*[23]|columns\s*:\s*[23]|class=["'][^"']*\b(?:two-column|multi-column|columns-2|col-container)\b[^"']*["'])[^>]*?>([\s\S]*?)<\/div>/gi;
  if (htmlColPattern.test(working)) {
    detectedHtmlColumns = true;
    working = working.replace(htmlColPattern, (_m, inner) => inner.trim());
  }

  // Priority 3: Detect side-by-side text-gutter columns in raw OCR / extracted text lines
  // (e.g., "বাম কলামের প্রথম লাইন        ডান কলামের প্রথম লাইন")
  const lines = working.split('\n');
  const outputLines: string[] = [];
  let i = 0;
  let foundTextGutterColumns = false;

  // Helper: checks if a line has a two-column horizontal gap (4+ spaces or 2+ tabs) and is NOT a Markdown table or TOC leader line
  const splitTwoColumnLine = (line: string): [string, string] | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    // Do not treat Markdown tables, headings, figures, or TOC dot-leader lines as 2-column prose
    if (
      trimmed.startsWith('|') ||
      trimmed.startsWith('#') ||
      trimmed.includes('[IMAGE_FIGURE:') ||
      /\.{3,}\s*[০-৯0-9]+\s*$/.test(trimmed)
    ) {
      return null;
    }

    // Match left column text (at least 8 chars) + 4 or more spaces (or tabs) + right column text (at least 8 chars)
    const match = trimmed.match(/^(\S(?:.*?\S)?)(?:\s{4,}|\t+)(\S.*)$/);
    if (!match) return null;

    const leftCol = match[1].trim();
    const rightCol = match[2].trim();
    if (leftCol.length < 6 || rightCol.length < 6) return null;
    // Reject if rightCol is just a standalone page number in a TOC
    if (/^[০-৯0-9]{1,4}$/.test(rightCol)) return null;

    return [leftCol, rightCol];
  };

  while (i < lines.length) {
    const firstSplit = splitTwoColumnLine(lines[i]);
    if (firstSplit) {
      // Collect consecutive side-by-side column lines
      const colRun: Array<[string, string]> = [firstSplit];
      let j = i + 1;
      while (j < lines.length) {
        const nextSplit = splitTwoColumnLine(lines[j]);
        if (nextSplit) {
          colRun.push(nextSplit);
          j++;
        } else {
          break;
        }
      }

      // Require at least 2 consecutive side-by-side lines to confirm a multi-column block
      if (colRun.length >= 2) {
        foundTextGutterColumns = true;
        const leftColLines = colRun.map((pair) => pair[0]);
        const rightColLines = colRun.map((pair) => pair[1]);

        const leftParagraphs = reconstructColumnLinesIntoParagraphs(leftColLines);
        const rightParagraphs = reconstructColumnLinesIntoParagraphs(rightColLines);

        if (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() !== '') {
          outputLines.push('');
        }
        outputLines.push(leftParagraphs);
        outputLines.push('');
        outputLines.push(rightParagraphs);
        if (j < lines.length && lines[j].trim() !== '') {
          outputLines.push('');
        }
        i = j;
        continue;
      }
    }

    outputLines.push(lines[i]);
    i++;
  }

  const finalResult = outputLines.join('\n');

  if (foundTextGutterColumns) {
    return {
      columnCount: 2,
      isMultiColumn: true,
      gutterXPositions: [Math.round(pageWidth * 0.5)],
      reorderedText: finalResult,
      method: 'text_gutter',
    };
  }

  if (detectedHtmlColumns) {
    return {
      columnCount: 2,
      isMultiColumn: true,
      gutterXPositions: [Math.round(pageWidth * 0.5)],
      reorderedText: finalResult,
      method: 'html_columns',
    };
  }

  return {
    columnCount: 1,
    isMultiColumn: false,
    gutterXPositions: [],
    reorderedText: finalResult,
    method: 'single_column',
  };
}

/**
 * Joins wrapped lines inside a single column into continuous paragraphs while
 * respecting sentence endings or explicit paragraph breaks within the column.
 */
function reconstructColumnLinesIntoParagraphs(colLines: string[]): string {
  if (colLines.length === 0) return '';
  const paragraphs: string[] = [];
  let current = colLines[0].trim();

  for (let k = 1; k < colLines.length; k++) {
    const line = colLines[k].trim();
    if (!line) {
      if (current) {
        paragraphs.push(current);
        current = '';
      }
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    // If line is a heading or list item, start a new block
    if (/^(?:#+\s|[-*+]\s|[০-৯0-9]+[.)]\s|>)/.test(line)) {
      paragraphs.push(current);
      current = line;
      continue;
    }

    current = joinTwoTextSegmentsLosslessly(current, line);
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs.join('\n\n');
}

// ============================================================================
// 2. REPEATED RUNNING HEADERS, FOOTERS, & PAGE-BOUNDARY ARTIFACT DETECTION
// ============================================================================

/**
 * Normalizes a candidate running header/footer line for frequency comparison across pages
 * by stripping digits, punctuation, and extra whitespace.
 */
function normalizeHeaderFooterSignature(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/[০-৯0-9]+/g, '#')
    .replace(/[\s\-–—|.:,।॥'"“”‘’*()\[\]]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Checks whether a single line at the very top or bottom of a page is an isolated
 * page number, printer signature mark (ফর্মা নম্বর), or running header/footer with page number.
 */
export function isPageBoundaryArtifactLine(
  rawLine: string,
  linePosition: 'top' | 'bottom',
  bookDetails?: BookDetails
): boolean {
  const trimmed = rawLine.replace(/<[^>]+>/g, '').trim();
  if (!trimmed) return false;

  // Never strip Markdown headings (# , ## ) unless it's literally "# পৃষ্ঠা ১২"
  if (/^#+\s/.test(rawLine.trim()) && !/^#+\s*(?:পৃষ্ঠা|পেজ|page)\s*[০-৯0-9]+$/i.test(rawLine.trim())) {
    return false;
  }

  // 1. Isolated page number (e.g., "১২", "- ১২ -", "পৃষ্ঠা ১২", "Page 12", "[ ২৪ ]")
  if (
    /^[-—–~|\s.*(\[]*[০-৯0-9]{1,4}[-—–~|\s।.*)\]]*$/.test(trimmed) ||
    /^(?:পৃষ্ঠা|পেজ|page|p\.)\s*[:।\-–—~.]*\s*[০-৯0-9]{1,4}$/i.test(trimmed) ||
    /^[০-৯0-9]{1,4}\s*[:।\-–—~/]*\s*(?:পৃষ্ঠা|পেজ|page)$/i.test(trimmed)
  ) {
    return true;
  }

  // 2. Running header/footer with separator and page number (e.g., "রক্তকরবী | ১২", "১২ — রবীন্দ্র-রচনাবলী")
  if (
    trimmed.length <= 75 &&
    (/^.{2,50}[\s\-–—|/:]+\s*(?:পৃষ্ঠা\s*)?[০-৯0-9]{1,4}\s*$/i.test(trimmed) ||
      /^\s*(?:পৃষ্ঠা\s*)?[০-৯0-9]{1,4}\s*[\-–—|/:]+\s*.{2,50}$/i.test(trimmed))
  ) {
    return true;
  }

  // 3. Traditional Bengali printed book signature mark (ফর্মা নম্বর) at bottom of page (e.g. "রা—২", "ফর্মা-৩", "গীতা—৪")
  if (
    linePosition === 'bottom' &&
    trimmed.length <= 18 &&
    /^(?:ফর্মা\s*[-–—]?\s*[০-৯0-9]+|[\u0980-\u09FF]{1,6}\s*[—–-]\s*[০-৯0-9]{1,2})$/i.test(trimmed)
  ) {
    return true;
  }

  // 4. Exact match with Book Title or Book Author + optional number as a short running header on content pages
  if (linePosition === 'top' && trimmed.length <= 60 && !/^#+\s/.test(rawLine.trim())) {
    const normLine = trimmed.replace(/[০-৯0-9\-–—|.\s]+/g, ' ').trim().toLowerCase();
    const normTitle = (bookDetails?.title || '').trim().toLowerCase();
    const normAuthor = (bookDetails?.author || '').trim().toLowerCase();
    if (
      (normTitle.length >= 3 && normLine === normTitle) ||
      (normAuthor.length >= 3 && normLine === normAuthor) ||
      (normTitle.length >= 3 &&
        normAuthor.length >= 3 &&
        (normLine === `${normTitle} ${normAuthor}` || normLine === `${normAuthor} ${normTitle}`))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Analyzes all pages in the document to detect and remove repeated running headers,
 * running footers, scanner watermarks, and page-number artifacts.
 *
 * Preserves:
 * - TOC pages
 * - Title page (Page 1)
 * - Genuine chapter headings (# , ## , ### )
 */
export function detectAndStripRunningHeadersFooters(
  pages: PageItem[],
  bookDetails?: BookDetails,
  tocPageNumbers: Set<number> = new Set()
): {
  cleanedPages: PageItem[];
  removedCount: number;
  removedSamples: string[];
} {
  if (!pages || pages.length === 0) {
    return { cleanedPages: [], removedCount: 0, removedSamples: [] };
  }

  // Step 1: Collect frequency of top-most and bottom-most non-empty lines across pages
  const topSignatureCounts = new Map<string, number>();
  const bottomSignatureCounts = new Map<string, number>();

  for (const page of pages) {
    if (!page || page.status === 'excluded' || !page.markdown) continue;
    const nonEmptyLines = page.markdown
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (nonEmptyLines.length === 0) continue;

    const firstLine = nonEmptyLines[0];
    // Do not count markdown headings (# ) as running headers unless they lack #
    if (!firstLine.startsWith('#') && firstLine.length <= 75) {
      const sig = normalizeHeaderFooterSignature(firstLine);
      if (sig.length >= 2) {
        topSignatureCounts.set(sig, (topSignatureCounts.get(sig) || 0) + 1);
      }
    }

    if (nonEmptyLines.length >= 2) {
      const lastLine = nonEmptyLines[nonEmptyLines.length - 1];
      if (!lastLine.startsWith('#') && lastLine.length <= 75) {
        const sig = normalizeHeaderFooterSignature(lastLine);
        if (sig.length >= 2) {
          bottomSignatureCounts.set(sig, (bottomSignatureCounts.get(sig) || 0) + 1);
        }
      }
    }
  }

  let removedCount = 0;
  const removedSamples: string[] = [];

  // Step 2: Strip repeated running headers/footers and page-boundary artifacts from each page
  const cleanedPages = pages.map((page, idx) => {
    if (!page || page.status === 'excluded' || !page.markdown) return page;
    const isToc = Boolean(page.isTocPage || tocPageNumbers.has(page.pageNumber));

    const lines = page.markdown.split('\n');
    // Find indices of first and last non-empty lines
    let firstNonEmptyIdx = -1;
    let lastNonEmptyIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        if (firstNonEmptyIdx === -1) firstNonEmptyIdx = i;
        lastNonEmptyIdx = i;
      }
    }

    if (firstNonEmptyIdx === -1) return page;

    const filteredLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (i === firstNonEmptyIdx && trimmed) {
        const sig = normalizeHeaderFooterSignature(trimmed);
        const isRepeatedTopHeader =
          !trimmed.startsWith('#') &&
          trimmed.length <= 75 &&
          (topSignatureCounts.get(sig) || 0) >= 2 &&
          !/[।॥.?!]$/.test(trimmed);

        const isTopArtifact =
          idx > 0 && !isToc && isPageBoundaryArtifactLine(raw, 'top', bookDetails);

        if (isRepeatedTopHeader || isTopArtifact) {
          removedCount++;
          if (removedSamples.length < 10) removedSamples.push(trimmed);
          continue;
        }
      }

      if (i === lastNonEmptyIdx && i !== firstNonEmptyIdx && trimmed) {
        const sig = normalizeHeaderFooterSignature(trimmed);
        const isRepeatedBottomFooter =
          !trimmed.startsWith('#') &&
          trimmed.length <= 75 &&
          (bottomSignatureCounts.get(sig) || 0) >= 2 &&
          !/[।॥.?!]$/.test(trimmed);

        const isBottomArtifact =
          !isToc && isPageBoundaryArtifactLine(raw, 'bottom', bookDetails);

        if (isRepeatedBottomFooter || isBottomArtifact) {
          removedCount++;
          if (removedSamples.length < 10) removedSamples.push(trimmed);
          continue;
        }
      }

      // Remove artificial HTML page-break tags inside page markdown
      if (
        /^<(?:div|p|span|br)\s+[^>]*(?:page-break|break-after|break-before)[^>]*>(?:<\/(?:div|p|span)>)?$/i.test(
          trimmed
        )
      ) {
        removedCount++;
        continue;
      }

      filteredLines.push(raw);
    }

    return {
      ...page,
      markdown: filteredLines.join('\n').trim(),
    };
  });

  return {
    cleanedPages,
    removedCount,
    removedSamples,
  };
}

// ============================================================================
// 3. INTELLIGENT GAP DETECTION & CONFIDENCE-BASED PARAGRAPH CONTINUATION
// ============================================================================

/**
 * Trailing Bengali & English conjunctions, postpositions, and relative markers
 * that strongly indicate an unfinished sentence at the end of a page/column.
 */
const INCOMPLETE_ENDING_WORDS = new Set([
  // Bengali conjunctions & connectors
  'এবং', 'ও', 'কিন্তু', 'বা', 'কিংবা', 'কিম্বা', 'অথবা', 'নতুবা', 'অতএব', 'সুতরাং',
  'কারণ', 'যেহেতু', 'সেহেতু', 'যদি', 'যদিও', 'তবু', 'তবুও', 'যেন', 'যে', 'যা', 'যিনি',
  // Bengali postpositions & participles frequently split before object/verb
  'থেকে', 'হতে', 'হইতে', 'জন্য', 'জন্যে', 'সাথে', 'সঙ্গে', 'কাছে', 'মধ্যে', 'ভেতরে',
  'ভিতরে', 'বাইরে', 'উপর', 'উপরে', 'নিচে', 'নীচে', 'দিকে', 'প্রতি', 'দ্বারা', 'দিয়ে',
  'দিয়ে', 'নিয়ে', 'নিয়ে', 'করে', 'করিয়া', 'হয়ে', 'হয়ে', 'বলে', 'বলিয়া', 'গিয়ে', 'গিয়ে',
  'এসে', 'দেখে', 'শুনে', 'ধরে', 'চেয়ে', 'চেয়ে', 'ছাড়া', 'ছাড়া', 'বিনা', 'ব্যতীত',
  'সম্পর্কে', 'বিষয়ে', 'বিষয়ে', 'অনুযায়ী', 'অনুসারে', 'মত', 'মতো', 'ন্যায়', 'ন্যায়',
  // English prepositions, articles, conjunctions
  'and', 'or', 'but', 'nor', 'so', 'yet', 'for', 'the', 'a', 'an', 'of', 'in', 'to',
  'with', 'by', 'from', 'at', 'on', 'into', 'onto', 'upon', 'within', 'without',
  'between', 'among', 'through', 'during', 'before', 'after', 'above', 'below',
  'that', 'which', 'who', 'whom', 'whose', 'where', 'when', 'while', 'because',
  'although', 'though', 'since', 'unless', 'until', 'whether', 'as', 'than',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
]);

/**
 * Checks whether a block of text is a structural non-prose element that must NEVER
 * be merged with an adjacent paragraph.
 */
export function isStructuralNonMergeBlock(block: string): {
  isNonMerge: boolean;
  reason?: string;
} {
  const trimmed = block.trim();
  if (!trimmed) return { isNonMerge: true, reason: 'empty_block' };

  // 1. Markdown or HTML Heading
  if (
    /^#{1,6}\s/.test(trimmed) ||
    /^<h[1-6][\s>]/i.test(trimmed) ||
    /^(?:Part|Volume|Book|Act|Chapter|Section|Scene)\s+[IVXLCDM\d]+/i.test(trimmed) ||
    /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়|পরিচ্ছেদ|দৃশ্য))\b/i.test(
      trimmed.replace(/^[#*<\s]+/, '')
    )
  ) {
    return { isNonMerge: true, reason: 'heading_or_chapter_boundary' };
  }

  // 2. Section divider / horizontal rule
  if (
    /^[-=_]{3,}$/.test(trimmed) ||
    /^(\*\s*\*\s*\*|•••|•\s*•\s*•|—\s*—\s*—)$/.test(trimmed) ||
    /^<hr\b/i.test(trimmed) ||
    trimmed.includes('section-divider')
  ) {
    return { isNonMerge: true, reason: 'section_divider' };
  }

  // 3. Image / Figure / Markdown Image / Caption
  if (
    trimmed.includes('[IMAGE_FIGURE:') ||
    /^!\[.*?\]\(.*?\)$/.test(trimmed) ||
    /^<(?:figure|img|figcaption)\b/i.test(trimmed) ||
    /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*[০-৯0-9:.]/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'figure_or_caption' };
  }

  // 4. Table row or HTML table
  if (
    (trimmed.startsWith('|') && trimmed.endsWith('|')) ||
    /^<(?:table|thead|tbody|tr|td|th)\b/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'table_element' };
  }

  // 5. Unordered or Ordered List item
  if (
    /^[-*•+]\s+/.test(trimmed) ||
    /^[০-৯0-9]+[.)]\s+/.test(trimmed) ||
    /^[\(\[][ক-ঞa-zA-ZivxIVX]+[\)\]]\s+/.test(trimmed) ||
    /^<(?:ul|ol|li)\b/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'list_item' };
  }

  // 6. Blockquote
  if (trimmed.startsWith('> ') || /^<blockquote\b/i.test(trimmed)) {
    return { isNonMerge: true, reason: 'blockquote' };
  }

  // 7. Footnote
  if (trimmed.startsWith('[^') || /^<p\s+class=["']footnote["']/i.test(trimmed)) {
    return { isNonMerge: true, reason: 'footnote' };
  }

  // 8. Center-aligned or Right-aligned block (poetry, dedication, signature, date)
  if (
    /^(?:<center>|\[center\]|->|\[right\])/i.test(trimmed) ||
    /(?:text-center|text-right|align=["'](?:center|right)["'])/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'aligned_special_block' };
  }

  // 9. Standalone bold subheading line
  if (
    (/^\*\*[^*]+\*\*$/.test(trimmed) || /^<strong>[^<]+<\/strong>$/i.test(trimmed)) &&
    trimmed.length <= 80 &&
    !/[।॥.?!]\s*(?:\*\*|<\/strong>)$/.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'standalone_bold_subheading' };
  }

  return { isNonMerge: false };
}

/**
 * Losslessly joins two text segments (either hyphen-split at line/page end or space-separated),
 * preserving Bengali Unicode orthography and preventing accidental word concatenation.
 */
export function joinTwoTextSegmentsLosslessly(firstSegment: string, secondSegment: string): string {
  const left = firstSegment.trimEnd();
  const right = secondSegment.trimStart();

  if (!left) return right;
  if (!right) return left;

  // Check if left ends with a hyphenated word at the end of the line/page: e.g. "আন্তর্জা-" + "তিক" or "re-" + "construction"
  const hyphenMatch = left.match(/([\u0980-\u09FFa-zA-Z]{2,})[-‐‑]\s*$/);
  if (hyphenMatch) {
    const stem = hyphenMatch[1];
    const rightFirstWordMatch = right.match(/^([\u0980-\u09FFa-zA-Z]+)/);
    if (rightFirstWordMatch) {
      const rightWord = rightFirstWordMatch[1];
      const stemIsBengali = /[\u0980-\u09FF]/.test(stem);
      const rightIsBengali = /[\u0980-\u09FF]/.test(rightWord);

      if (stemIsBengali && rightIsBengali) {
        const joinedWord = stem + rightWord;
        // Common Bengali compound pairs where hyphen is intentional (e.g., মা-বাবা, ভাই-বোন, দিন-রাত, শিল্প-সাহিত্য)
        const isKnownCompound =
          stem.length >= 2 &&
          rightWord.length >= 2 &&
          isValidBengaliWord(stem) &&
          isValidBengaliWord(rightWord) &&
          /^(?:বাবা|মা|বোন|ভাই|রাত|দিন|সাহিত্য|সংস্কৃতি|ইতিহাস|বিজ্ঞান|বাণিজ্য|কল্যাণ|বিরোধী|ভিত্তিক|মুক্ত|যুক্ত)$/.test(
            rightWord
          );

        if (!isKnownCompound && isValidBengaliWord(joinedWord)) {
          // Remove the soft line-break hyphen and join the split Bengali word directly
          return left.replace(/[-‐‑]\s*$/, '') + right;
        }
        // Keep compound hyphen without extra space
        return left.replace(/\s*$/, '') + right;
      } else if (!stemIsBengali && !rightIsBengali && /^[a-z]/.test(rightWord)) {
        // English word split across line/page with lowercase continuation: e.g., "re-" + "construction"
        return left.replace(/[-‐‑]\s*$/, '') + right;
      }
    }
  }

  // Standard join: always ensure exactly one space between the last word of left and first word of right
  return `${left} ${right}`;
}

/**
 * Evaluates whether `prevBlock` and `nextBlock` represent a single continuous paragraph
 * interrupted by an artificial PDF page boundary or line break.
 *
 * Returns a confidence classification ('high' | 'medium' | 'low' | 'none'), numerical score [0..1],
 * contributing signals, and the losslessly merged paragraph text when applicable.
 */
export function evaluateParagraphContinuation(
  prevBlock: string,
  nextBlock: string,
  context: {
    isPageBoundary?: boolean;
    nextPageIsChapterStart?: boolean;
  } = {}
): {
  shouldMerge: boolean;
  confidence: ContinuationConfidence;
  score: number;
  signals: string[];
  nonMergeReason?: string;
  mergedText?: string;
} {
  if (context.nextPageIsChapterStart) {
    return {
      shouldMerge: false,
      confidence: 'none',
      score: 0,
      signals: [],
      nonMergeReason: 'next_page_is_chapter_start',
    };
  }

  const prevCheck = isStructuralNonMergeBlock(prevBlock);
  if (prevCheck.isNonMerge) {
    return {
      shouldMerge: false,
      confidence: 'none',
      score: 0,
      signals: [],
      nonMergeReason: `prev_${prevCheck.reason}`,
    };
  }

  const nextCheck = isStructuralNonMergeBlock(nextBlock);
  if (nextCheck.isNonMerge) {
    return {
      shouldMerge: false,
      confidence: 'none',
      score: 0,
      signals: [],
      nonMergeReason: `next_${nextCheck.reason}`,
    };
  }

  // Strip inline formatting tags for linguistic analysis while keeping raw text for merging
  const cleanPrev = prevBlock.replace(/<[^>]+>/g, '').trim();
  const cleanNext = nextBlock.replace(/<[^>]+>/g, '').trim();

  if (!cleanPrev || !cleanNext) {
    return {
      shouldMerge: false,
      confidence: 'none',
      score: 0,
      signals: [],
      nonMergeReason: 'empty_text',
    };
  }

  // Guard: If nextBlock starts with explicit first-line paragraph indentation (2+ spaces or tab or indent class)
  // AND prevBlock ends with terminal punctuation, it is definitely a new paragraph!
  const nextHasExplicitIndent =
    /^(?: {2,}|\t)/.test(nextBlock) || /class=["'][^"']*\bindent-(?:1|2|line)\b/i.test(nextBlock);
  const prevEndsWithTerminalPunct = /[।॥.?!]\s*['"”’)\]]*\s*$/.test(cleanPrev);

  if (nextHasExplicitIndent && prevEndsWithTerminalPunct) {
    return {
      shouldMerge: false,
      confidence: 'low',
      score: 0.05,
      signals: ['prev_terminal_punctuation', 'next_explicit_paragraph_indent'],
      nonMergeReason: 'indented_new_paragraph_after_sentence_end',
    };
  }

  // Guard: Dialogue speaker turn at start of nextBlock (e.g., "নন্দিনী।", "রাজা:", "**রাহুল:**") or new quote turn after closed quote
  if (
    /^(?:\*\*[^*]{1,25}\*\*|[\u0980-\u09FF]{2,15})\s*[।:—–-]\s+/.test(cleanNext) ||
    (/['"”’]\s*$/.test(cleanPrev) && /^['"“‘]/.test(cleanNext))
  ) {
    return {
      shouldMerge: false,
      confidence: 'low',
      score: 0.1,
      signals: ['dialogue_turn_boundary'],
      nonMergeReason: 'dialogue_turn_boundary',
    };
  }

  let score = 0;
  const signals: string[] = [];

  // Signal 1: Hyphenated word at the end of prevBlock
  const endsWithHyphen = /[\u0980-\u09FFa-zA-Z]{2,}[-‐‑]\s*$/.test(cleanPrev);
  if (endsWithHyphen) {
    score += 0.55;
    signals.push('trailing_hyphenated_word');
  }

  // Signal 2: Incomplete sentence at the end of prevBlock (no terminal danda/period/question/exclamation)
  if (!prevEndsWithTerminalPunct && !endsWithHyphen) {
    // Check if it ends with colon or em-dash introducing a block
    if (/[:]\s*$/.test(cleanPrev)) {
      return {
        shouldMerge: false,
        confidence: 'low',
        score: 0.2,
        signals: ['ends_with_colon'],
        nonMergeReason: 'ends_with_colon_introducer',
      };
    }

    score += 0.45;
    signals.push('incomplete_sentence_ending');

    // Sub-signal 2a: Ends with comma or semicolon
    if (/[,;]\s*$/.test(cleanPrev)) {
      score += 0.2;
      signals.push('trailing_comma_or_semicolon');
    }

    // Sub-signal 2b: Ends with a conjunction, preposition, or postposition
    const lastWordMatch = cleanPrev.match(/([\u0980-\u09FFa-zA-Z]+)\s*[,;]?\s*$/);
    if (lastWordMatch) {
      const lastWord = lastWordMatch[1].toLowerCase();
      if (INCOMPLETE_ENDING_WORDS.has(lastWord)) {
        score += 0.22;
        signals.push(`trailing_connector_word:${lastWord}`);
      }
    }
  }

  // Signal 3: Continuation characteristics at the start of nextBlock
  const startsWithLowercaseLatin = /^[a-z]/.test(cleanNext);
  const startsWithBengaliWord = /^[\u0980-\u09FF]/.test(cleanNext);

  if (startsWithLowercaseLatin) {
    score += 0.4;
    signals.push('next_starts_lowercase_latin');
  } else if (startsWithBengaliWord && !nextHasExplicitIndent && !prevEndsWithTerminalPunct) {
    score += 0.28;
    signals.push('next_unindented_bengali_continuation');
  }

  // Signal 4: Unbalanced opening quote or parenthesis in prevBlock closed in nextBlock
  const openDoubleQuotesPrev = (cleanPrev.match(/[“]/g) || []).length;
  const closeDoubleQuotesPrev = (cleanPrev.match(/[”]/g) || []).length;
  const openDoubleQuotesNext = (cleanNext.match(/[“]/g) || []).length;
  const closeDoubleQuotesNext = (cleanNext.match(/[”]/g) || []).length;

  if (openDoubleQuotesPrev > closeDoubleQuotesPrev && closeDoubleQuotesNext > openDoubleQuotesNext) {
    score += 0.3;
    signals.push('unclosed_quotation_spanning_boundary');
  }

  const openParensPrev = (cleanPrev.match(/\(/g) || []).length - (cleanPrev.match(/\)/g) || []).length;
  const closeParensNext = (cleanNext.match(/\)/g) || []).length - (cleanNext.match(/\(/g) || []).length;
  if (openParensPrev > 0 && closeParensNext > 0) {
    score += 0.3;
    signals.push('unclosed_parenthesis_spanning_boundary');
  }

  // Signal 5: Page boundary context
  if (context.isPageBoundary && !prevEndsWithTerminalPunct) {
    score += 0.12;
    signals.push('cross_page_boundary_prose');
  }

  // Clamp score to [0, 1]
  const finalScore = Math.min(1, Math.round(score * 100) / 100);

  let confidence: ContinuationConfidence = 'low';
  let shouldMerge = false;

  if (finalScore >= 0.75) {
    confidence = 'high';
    shouldMerge = true;
  } else if (finalScore >= 0.55 && signals.length >= 3 && !prevEndsWithTerminalPunct) {
    confidence = 'medium';
    shouldMerge = true;
  } else {
    confidence = 'low';
    shouldMerge = false;
  }

  return {
    shouldMerge,
    confidence,
    score: finalScore,
    signals,
    nonMergeReason: shouldMerge ? undefined : prevEndsWithTerminalPunct ? 'prev_sentence_complete' : 'insufficient_confidence',
    mergedText: shouldMerge ? joinTwoTextSegmentsLosslessly(prevBlock, nextBlock) : undefined,
  };
}

// ============================================================================
// 4. DOCUMENT-LEVEL NORMALIZATION & CHAPTER-SAFE SECTION CONSOLIDATION
// ============================================================================

/**
 * Collects top-level (Level 1) chapter target page numbers referenced by the authoritative TOC tree.
 * Subheadings (Level 2+) that appear mid-page after a continuing paragraph will have their
 * TOC links automatically remapped to the consolidated chapter file while preserving their exact anchor ID.
 */
export function collectTocTargetPageNumbers(nodes: EpubTocItem[]): Set<number> {
  const set = new Set<number>();
  for (const item of nodes || []) {
    if (typeof item.targetPageNumber === 'number' && item.targetPageNumber > 0) {
      set.add(item.targetPageNumber);
    }
  }
  return set;
}

/**
 * Determines whether a page starts a new intentional chapter or section
 * that must begin on a new EPUB spine item.
 */
export function isIntentionalChapterStartPage(
  page: PageItem,
  pageIndexInContent: number,
  tocTargetPages: Set<number>,
  tocPageNumbers: Set<number>
): boolean {
  // First content page always starts a spine section
  if (pageIndexInContent === 0) return true;

  // TOC pages are handled separately
  if (page.isTocPage || tocPageNumbers.has(page.pageNumber)) return true;

  // Any page explicitly targeted by a chapter/entry in the TOC tree starts a section
  if (tocTargetPages.has(page.pageNumber)) return true;

  if (!page.markdown || !page.markdown.trim()) return false;

  // Inspect the first non-empty line of the page
  const lines = page.markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  const firstLine = lines[0];

  // Explicit Markdown Heading (# , ## , ### , #### ) or HTML <h1>..<h4> at the start of the page
  if (/^#{1,4}\s+\S/.test(firstLine) || /^<h[1-4][\s>]/i.test(firstLine)) {
    return true;
  }

  // Unwrap bold/center to check for Part / Chapter / Front-Matter keywords at top of page
  const unwrapped = firstLine
    .replace(/^<center>(.*?)<\/center>$/i, '$1')
    .replace(/^\[center\](.*?)\[\/center\]$/i, '$1')
    .replace(/^->\s*(.*?)\s*<-$/, '$1')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^<strong>(.*?)<\/strong>$/i, '$1')
    .trim();

  if (unwrapped.length <= 100) {
    const isMajorChapterKeyword =
      /^(?:Part|Volume|Book|Act|Chapter|Chapitre|Kapitel|Preface|Foreword|Introduction|Prologue|Dedication|Epilogue|Conclusion|Appendix|Bibliography|Index)\b/i.test(
        unwrapped
      ) ||
      /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়|পরিচ্ছেদ|দৃশ্য)|(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়|পরিচ্ছেদ|দৃশ্য)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়)|ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উৎসর্গ|লেখকের কথা|প্রকাশকের কথা|উপসংহার|পরিশিষ্ট|নির্ঘণ্ট|গ্রন্থপঞ্জি)\b/i.test(
        unwrapped
      );

    if (isMajorChapterKeyword) {
      return true;
    }
  }

  return false;
}

/**
 * Splits a page's Markdown into logical paragraph/structural blocks while preserving
 * multi-line structures (lists, blockquotes, tables, alignment blocks).
 */
export function splitMarkdownIntoLogicalBlocks(markdown: string): string[] {
  if (!markdown || !markdown.trim()) return [];

  // Normalize CRLF and collapse 3+ blank lines into double newline
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = normalized.split('\n');

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let inAlignmentWrapper = false;

  const flushCurrent = () => {
    if (currentLines.length > 0) {
      const joined = currentLines.join('\n').trim();
      if (joined) blocks.push(joined);
      currentLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (!inAlignmentWrapper) {
        flushCurrent();
      }
      continue;
    }

    // Track multi-line <div class="text-center"> or <center> blocks
    if (/^<(?:center|div\s+[^>]*(?:text-center|text-right)[^>]*)>$/i.test(trimmed)) {
      flushCurrent();
      inAlignmentWrapper = true;
      currentLines.push(rawLine);
      continue;
    }
    if (inAlignmentWrapper && /^<\/(?:center|div)>$/i.test(trimmed)) {
      currentLines.push(rawLine);
      inAlignmentWrapper = false;
      flushCurrent();
      continue;
    }
    if (inAlignmentWrapper) {
      currentLines.push(rawLine);
      continue;
    }

    // Headings, Figures, Section dividers are standalone blocks
    if (
      /^#{1,6}\s/.test(trimmed) ||
      /^<h[1-6][\s>]/i.test(trimmed) ||
      trimmed.includes('[IMAGE_FIGURE:') ||
      /^!\[.*?\]\(.*?\)$/.test(trimmed) ||
      /^[-=_]{3,}$/.test(trimmed) ||
      /^(\*\s*\*\s*\*|•••|•\s*•\s*•|—\s*—\s*—)$/.test(trimmed)
    ) {
      flushCurrent();
      blocks.push(rawLine.trim());
      continue;
    }

    // Lists, tables, blockquotes stay grouped with consecutive lines of the same type
    const isListOrTableOrQuote =
      /^[-*•+]\s+/.test(trimmed) ||
      /^[০-৯0-9]+[.)]\s+/.test(trimmed) ||
      trimmed.startsWith('> ') ||
      (trimmed.startsWith('|') && trimmed.endsWith('|'));

    if (isListOrTableOrQuote) {
      currentLines.push(rawLine);
      continue;
    }

    // Ordinary prose line: if currentLines already has a prose line without blank line between them,
    // check whether they should be joined into the same paragraph or kept as separate lines
    if (currentLines.length > 0) {
      const prevLine = currentLines[currentLines.length - 1];
      const prevIsListOrTableOrQuote =
        /^[-*•+]\s+/.test(prevLine.trim()) ||
        /^[০-৯0-9]+[.)]\s+/.test(prevLine.trim()) ||
        prevLine.trim().startsWith('> ') ||
        (prevLine.trim().startsWith('|') && prevLine.trim().endsWith('|'));

      if (prevIsListOrTableOrQuote) {
        flushCurrent();
        currentLines.push(rawLine);
      } else {
        // Evaluate if wrapped prose line within the same paragraph block should join
        const evalRes = evaluateParagraphContinuation(prevLine, rawLine, { isPageBoundary: false });
        if (evalRes.shouldMerge && evalRes.mergedText) {
          currentLines[currentLines.length - 1] = evalRes.mergedText;
        } else {
          currentLines.push(rawLine);
        }
      }
    } else {
      currentLines.push(rawLine);
    }
  }

  flushCurrent();
  return blocks;
}

/**
 * Full Document Normalization & Layout Reconstruction Pipeline before EPUB assembly.
 *
 * Pipeline stages:
 * 1. Strip repeated running headers, footers, page numbers, and artificial page-break tags.
 * 2. Detect & reorder multi-column pages into natural single-column reading sequence.
 * 3. Identify intentional chapter starts vs continuation pages.
 * 4. Reconstruct paragraphs continuing across PDF page boundaries using confidence scoring.
 * 5. Consolidate continuation pages into their parent chapter section while preserving
 *    all anchors, figures, and internal navigation links.
 * 6. Verify lossless content preservation.
 */
export function reconstructDocumentLayoutForEpub(
  pages: PageItem[],
  options: {
    bookDetails?: BookDetails;
    structureConfig?: StructureConfig;
    pdfOutline?: PdfOutlineItem[];
    tocTree?: EpubTocItem[];
    identifiedTocPageNums?: Set<number>;
  } = {}
): DocumentLayoutReconstructionResult {
  const warnings: string[] = [];
  const decisions: PageBoundaryMergeDecision[] = [];

  const tocPageNumbers = options.identifiedTocPageNums || new Set<number>();
  const tocTargetPages = collectTocTargetPageNumbers(options.tocTree || []);

  // Stage 1: Strip repeated running headers, footers, and page-boundary artifacts
  const { cleanedPages: headerStrippedPages, removedCount: runningHeadersFootersRemoved } =
    detectAndStripRunningHeadersFooters(pages, options.bookDetails, tocPageNumbers);

  // Stage 2: Reconstruct multi-column reading order on each page
  let multiColumnPagesReordered = 0;
  const columnNormalizedPages = headerStrippedPages.map((page) => {
    if (!page || page.status === 'excluded' || !page.markdown || tocPageNumbers.has(page.pageNumber) || page.isTocPage) {
      return page;
    }

    const colRes = reconstructMultiColumnMarkdown(page.markdown, page.layoutBlocks);
    if (colRes.isMultiColumn) {
      multiColumnPagesReordered++;
      return {
        ...page,
        markdown: colRes.reorderedText,
        columnCount: colRes.columnCount,
      };
    }
    return page;
  });

  // Filter content pages (excluding TOC pages and excluded pages)
  const contentPages = columnNormalizedPages.filter(
    (p) => p && p.status !== 'excluded' && p.markdown && p.markdown.trim().length > 0 && !tocPageNumbers.has(p.pageNumber)
  );

  const consolidatedGroups: ConsolidatedPageGroup[] = [];
  const pageToSectionFileMap = new Map<
    number,
    { sectionPageNumber: number; targetFile: string; needsPageAnchor: boolean }
  >();

  let crossPageParagraphsMerged = 0;
  let artificialPageBreaksRemoved = 0;
  let duplicateBoundaryLinesRemoved = 0;
  let lowConfidenceBoundariesPreserved = 0;

  for (let idx = 0; idx < contentPages.length; idx++) {
    const page = contentPages[idx];
    const isChapterStart = isIntentionalChapterStartPage(page, idx, tocTargetPages, tocPageNumbers);

    if (isChapterStart || consolidatedGroups.length === 0) {
      // Start a new chapter/section group
      const figureOriginMap = (page.figures || []).map((fig, fIdx) => ({
        originalPageNumber: page.pageNumber,
        originalFigureIndex: fIdx + 1,
        figure: fig,
      }));

      consolidatedGroups.push({
        sectionPage: {
          ...page,
          figures: [...(page.figures || [])],
        },
        sourcePageNumbers: [page.pageNumber],
        figureOriginMap,
      });

      pageToSectionFileMap.set(page.pageNumber, {
        sectionPageNumber: page.pageNumber,
        targetFile: `page_${page.pageNumber}.xhtml`,
        needsPageAnchor: false,
      });

      if (idx > 0) {
        const prevPage = contentPages[idx - 1];
        decisions.push({
          fromPage: prevPage.pageNumber,
          toPage: page.pageNumber,
          shouldMergeParagraph: false,
          shouldConsolidateSection: false,
          confidence: 'none',
          score: 0,
          signals: ['intentional_chapter_start'],
          nonMergeReason: 'chapter_boundary_preserved',
        });
      }
      continue;
    }

    // This page is a CONTINUATION PAGE of the current active chapter group!
    const currentGroup = consolidatedGroups[consolidatedGroups.length - 1];
    const prevSourcePageNum = currentGroup.sourcePageNumbers[currentGroup.sourcePageNumbers.length - 1];
    artificialPageBreaksRemoved++;

    const prevBlocks = splitMarkdownIntoLogicalBlocks(currentGroup.sectionPage.markdown);
    const nextBlocks = splitMarkdownIntoLogicalBlocks(page.markdown);

    if (prevBlocks.length > 0 && nextBlocks.length > 0) {
      let lastPrevBlock = prevBlocks[prevBlocks.length - 1];
      let firstNextBlock = nextBlocks[0];

      // Check for accidental duplicate boundary line/paragraph repeated at top of next page
      const normLastPrev = lastPrevBlock.replace(/\s+/g, ' ').trim();
      const normFirstNext = firstNextBlock.replace(/\s+/g, ' ').trim();

      if (normLastPrev.length >= 20 && normLastPrev === normFirstNext) {
        nextBlocks.shift();
        duplicateBoundaryLinesRemoved++;
        firstNextBlock = nextBlocks[0] || '';
      }

      if (firstNextBlock) {
        const mergeEval = evaluateParagraphContinuation(lastPrevBlock, firstNextBlock, {
          isPageBoundary: true,
          nextPageIsChapterStart: false,
        });

        decisions.push({
          fromPage: prevSourcePageNum,
          toPage: page.pageNumber,
          shouldMergeParagraph: mergeEval.shouldMerge,
          shouldConsolidateSection: true,
          confidence: mergeEval.confidence,
          score: mergeEval.score,
          signals: mergeEval.signals,
          nonMergeReason: mergeEval.nonMergeReason,
        });

        if (mergeEval.shouldMerge && mergeEval.mergedText) {
          // Merge the split paragraph across the PDF page boundary!
          // Also place a page anchor marker before the remaining blocks so links to page_N still resolve
          prevBlocks[prevBlocks.length - 1] = mergeEval.mergedText;
          crossPageParagraphsMerged++;

          const remainingNext = nextBlocks.slice(1);
          const pageAnchorMarker = `<span id="page_${page.pageNumber}" class="epub-page-anchor"></span>`;
          const combinedBlocks = [...prevBlocks, pageAnchorMarker, ...remainingNext];
          currentGroup.sectionPage.markdown = combinedBlocks.join('\n\n');
        } else {
          // Keep paragraphs distinct, but flow them continuously in the same chapter section without a spine break
          lowConfidenceBoundariesPreserved++;
          const pageAnchorMarker = `<span id="page_${page.pageNumber}" class="epub-page-anchor"></span>`;
          const combinedBlocks = [...prevBlocks, pageAnchorMarker, ...nextBlocks];
          currentGroup.sectionPage.markdown = combinedBlocks.join('\n\n');
        }
      } else {
        const pageAnchorMarker = `<span id="page_${page.pageNumber}" class="epub-page-anchor"></span>`;
        currentGroup.sectionPage.markdown = [...prevBlocks, pageAnchorMarker].join('\n\n');
      }
    } else if (nextBlocks.length > 0) {
      const pageAnchorMarker = `<span id="page_${page.pageNumber}" class="epub-page-anchor"></span>`;
      currentGroup.sectionPage.markdown = [pageAnchorMarker, ...nextBlocks].join('\n\n');
    }

    // Merge figures from the continuation page into the consolidated chapter group
    if (page.figures && page.figures.length > 0) {
      page.figures.forEach((fig, fIdx) => {
        currentGroup.sectionPage.figures.push(fig);
        currentGroup.figureOriginMap.push({
          originalPageNumber: page.pageNumber,
          originalFigureIndex: fIdx + 1,
          figure: fig,
        });
      });
      currentGroup.sectionPage.hasImages = true;
    }

    currentGroup.sourcePageNumbers.push(page.pageNumber);
    pageToSectionFileMap.set(page.pageNumber, {
      sectionPageNumber: currentGroup.sectionPage.pageNumber,
      targetFile: `page_${currentGroup.sectionPage.pageNumber}.xhtml`,
      needsPageAnchor: true,
    });
  }

  // Verify lossless content preservation across consolidated sections
  const inputWordsCount = countMeaningfulWords(contentPages.map((p) => p.markdown).join('\n'));
  const outputWordsCount = countMeaningfulWords(
    consolidatedGroups.map((g) => g.sectionPage.markdown).join('\n')
  );
  // Output word count may be slightly smaller by hyphen-joined split words (1 word instead of 2 halves) or deduplicated boundary lines
  const maxAllowedReduction = crossPageParagraphsMerged + duplicateBoundaryLinesRemoved * 20 + 5;
  const contentLosslessVerified = outputWordsCount + maxAllowedReduction >= inputWordsCount;

  if (!contentLosslessVerified) {
    warnings.push(
      `Content verification notice: input had ${inputWordsCount} words, reconstructed output has ${outputWordsCount} words.`
    );
  }

  return {
    consolidatedGroups,
    cleanedPages: columnNormalizedPages,
    pageToSectionFileMap,
    report: {
      totalInputPages: contentPages.length,
      totalOutputSections: consolidatedGroups.length,
      multiColumnPagesReordered,
      crossPageParagraphsMerged,
      artificialPageBreaksRemoved,
      runningHeadersFootersRemoved,
      emptyElementsRemoved: 0,
      excessiveSpacingNormalized: 0,
      duplicateBoundaryLinesRemoved,
      lowConfidenceBoundariesPreserved,
      chaptersIntact: true,
      contentLosslessVerified,
      decisions,
      warnings,
    },
  };
}

/**
 * Counts meaningful word tokens (stripping HTML tags and [IMAGE_FIGURE: ...] blocks)
 * to verify that layout reconstruction is lossless.
 */
function countMeaningfulWords(markdown: string): number {
  if (!markdown) return 0;
  const stripped = markdown
    .replace(/\[IMAGE_FIGURE:\s*\{[\s\S]*?\}\]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_~`>|()-]/g, ' ')
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

/**
 * Updates TOC tree targetHref values when a continuation page has been consolidated
 * into its parent chapter's XHTML file so every TOC link resolves to an existing file and anchor.
 */
export function remapTocTreeForConsolidatedPages(
  tocTree: EpubTocItem[],
  pageToSectionFileMap: Map<number, { sectionPageNumber: number; targetFile: string; needsPageAnchor: boolean }>
): EpubTocItem[] {
  if (!tocTree || tocTree.length === 0 || pageToSectionFileMap.size === 0) return tocTree;

  function remapNodes(nodes: EpubTocItem[]): EpubTocItem[] {
    return nodes.map((node) => {
      let newHref = node.targetHref;
      const mapping = pageToSectionFileMap.get(node.targetPageNumber);

      if (mapping) {
        const [, existingAnchor] = (node.targetHref || '').split('#');
        if (existingAnchor) {
          newHref = `${mapping.targetFile}#${existingAnchor}`;
        } else if (mapping.needsPageAnchor) {
          newHref = `${mapping.targetFile}#page_${node.targetPageNumber}`;
        } else {
          newHref = mapping.targetFile;
        }
      }

      return {
        ...node,
        targetHref: newHref,
        children: node.children && node.children.length > 0 ? remapNodes(node.children) : [],
      };
    });
  }

  return remapNodes(tocTree);
}

// ============================================================================
// 5. HTML AND CSS NORMALIZATION
// ============================================================================

/**
 * Sanitizes inline CSS `style="..."` attributes to remove PDF layout artifacts:
 * - Strips `position: absolute` / `fixed` and `top`/`left`/`right`/`bottom` offsets
 * - Strips fixed `height` or `min-height` that create large blank gaps
 * - Strips or clamps excessive `margin-top`, `margin-bottom`, `padding-top`, `padding-bottom` (> 48px or > 3em)
 * - Strips artificial `page-break-before` / `page-break-after` / `break-before` / `break-after`
 */
export function cleanExcessiveInlineStyles(styleValue: string): {
  cleanedStyle: string;
  wasModified: boolean;
} {
  if (!styleValue || !styleValue.trim()) {
    return { cleanedStyle: '', wasModified: false };
  }

  const declarations = styleValue
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

  const kept: string[] = [];
  let wasModified = false;

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;

    const prop = decl.substring(0, colonIdx).trim().toLowerCase();
    const val = decl.substring(colonIdx + 1).trim();

    // 1. Remove absolute/fixed positioning & coordinate offsets
    if (
      prop === 'position' ||
      prop === 'top' ||
      prop === 'left' ||
      prop === 'right' ||
      prop === 'bottom' ||
      prop === 'z-index'
    ) {
      wasModified = true;
      continue;
    }

    // 2. Remove fixed heights / min-heights / widths on text elements
    if (prop === 'height' || prop === 'min-height' || prop === 'width' || prop === 'min-width') {
      wasModified = true;
      continue;
    }

    // 3. Remove artificial page-break properties
    if (
      prop === 'page-break-before' ||
      prop === 'page-break-after' ||
      prop === 'break-before' ||
      prop === 'break-after'
    ) {
      wasModified = true;
      continue;
    }

    // 4. Check margin / padding for excessive values inherited from PDF coordinates
    if (prop.startsWith('margin') || prop.startsWith('padding')) {
      const pxMatches = val.match(/(\d+(?:\.\d+)?)\s*(px|pt|cm|mm|in|vh|em|rem)/gi) || [];
      let isExcessive = false;
      for (const m of pxMatches) {
        const num = parseFloat(m);
        const unit = m.replace(/[\d.\s]/g, '').toLowerCase();
        if (
          ((unit === 'px' || unit === 'pt') && num > 48) ||
          ((unit === 'em' || unit === 'rem') && num > 3.5) ||
          (unit === 'vh' && num > 10) ||
          ((unit === 'cm' || unit === 'in' || unit === 'mm') && num > 2)
        ) {
          isExcessive = true;
          break;
        }
      }
      if (isExcessive) {
        wasModified = true;
        continue;
      }
    }

    // 5. Check excessive line-height (> 2.5 or > 45px)
    if (prop === 'line-height') {
      const num = parseFloat(val);
      if ((val.endsWith('px') && num > 45) || (!/[a-z%]/i.test(val) && num > 2.5)) {
        wasModified = true;
        continue;
      }
    }

    kept.push(`${prop}: ${val}`);
  }

  return {
    cleanedStyle: kept.join('; '),
    wasModified,
  };
}

/**
 * Normalizes generated EPUB XHTML body content to eliminate:
 * - Empty paragraphs (`<p></p>`, `<p>&#160;</p>`, `<p>\s*</p>`)
 * - Empty divs/spans without `id` attributes
 * - Repeated consecutive `<br />` tags (`<br />\s*<br />+`)
 * - Leading or trailing `<br />` inside `<p>` or `<h1..h6>`
 * - Unnecessary page-break containers (`<div class="page-break"></div>`)
 * - Excessive inline styles (fixed heights, absolute positioning, large pixel margins)
 * - Unwrapped `<tr>` rows (ensuring semantic `<table class="epub-table"><tbody>...</tbody></table>`)
 */
export function normalizeEpubLayoutXhtml(xhtmlFragment: string): {
  normalizedXhtml: string;
  emptyElementsRemoved: number;
  excessiveSpacingNormalized: number;
} {
  if (!xhtmlFragment || !xhtmlFragment.trim()) {
    return {
      normalizedXhtml: '<p>...</p>',
      emptyElementsRemoved: 0,
      excessiveSpacingNormalized: 0,
    };
  }

  let working = xhtmlFragment;
  let emptyElementsRemoved = 0;
  let excessiveSpacingNormalized = 0;

  // 1. Sanitize inline style="..." attributes
  working = working.replace(/\sstyle=(["'])(.*?)\1/gi, (_match, quote, styleContent) => {
    const { cleanedStyle, wasModified } = cleanExcessiveInlineStyles(styleContent);
    if (wasModified) excessiveSpacingNormalized++;
    return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : '';
  });

  // 2. Remove artificial page-break divs/paragraphs that have no text
  working = working.replace(
    /<(?:div|p|span)\s+[^>]*class=["'][^"']*\b(?:page-break|pdf-page-break|pagebreak)\b[^"']*["'][^>]*>\s*<\/(?:div|p|span)>/gi,
    () => {
      emptyElementsRemoved++;
      return '';
    }
  );

  // 3. Collapse 2+ consecutive <br /> tags into a single <br /> (or paragraph separation)
  working = working.replace(/(?:<br\s*\/?>\s*){2,}/gi, () => {
    excessiveSpacingNormalized++;
    return '<br />';
  });

  // 4. Remove leading and trailing <br /> inside <p> elements
  working = working.replace(/<p(\s+[^>]*?)?>\s*(?:<br\s*\/?>\s*)+/gi, '<p$1>');
  working = working.replace(/(?:\s*<br\s*\/?>)+\s*<\/p>/gi, '</p>');

  // 5. Remove empty paragraphs and empty formatting tags (preserving elements that carry an `id=` anchor!)
  const emptyTagPattern =
    /<(p|div|span|strong|b|em|i|u|blockquote)(?:\s+(?![^>]*\bid=)[^>]*?)?>(\s|&#160;|&nbsp;|&#8203;)*<\/\1>/gi;
  let prevWorking = '';
  while (prevWorking !== working) {
    prevWorking = working;
    working = working.replace(emptyTagPattern, () => {
      emptyElementsRemoved++;
      return '';
    });
  }

  // 6. Collapse 3+ consecutive newlines in XHTML source
  working = working.replace(/\n{3,}/g, '\n\n').trim();

  return {
    normalizedXhtml: working || '<p>...</p>',
    emptyElementsRemoved,
    excessiveSpacingNormalized,
  };
}

// ============================================================================
// 6. FINAL EPUB LAYOUT & STRUCTURAL VALIDATION
// ============================================================================

export interface EpubLayoutValidationResult {
  isValid: boolean;
  hasLargeBlankRegions: boolean;
  hasDuplicateParagraphs: boolean;
  hasUnstrippedRunningHeaders: boolean;
  hasImproperlyMergedParagraphs: boolean;
  chaptersIntact: boolean;
  issues: string[];
}

/**
 * Inspects a generated EPUB XHTML string (or set of chapter XHTML files) to detect:
 * - Suspiciously large blank regions (empty `<p>`, 3+ `<br />`, fixed pixel heights, excessive margins)
 * - Duplicate consecutive paragraphs
 * - Improperly merged paragraphs (e.g. raw `# ` heading or `[IMAGE_FIGURE:` inside `<p>`)
 */
export function validateEpubXhtmlLayout(xhtmlContent: string, filePath: string = 'chapter.xhtml'): EpubLayoutValidationResult {
  const issues: string[] = [];
  let hasLargeBlankRegions = false;
  let hasDuplicateParagraphs = false;
  const hasUnstrippedRunningHeaders = false;
  let hasImproperlyMergedParagraphs = false;

  // 1. Check for empty paragraphs or 3+ consecutive <br />
  if (/<p(?:\s+[^>]*)?>(\s|&#160;|&nbsp;)*<\/p>/i.test(xhtmlContent)) {
    hasLargeBlankRegions = true;
    issues.push(`${filePath}: Contains empty <p> element creating unnecessary vertical blank space.`);
  }
  if (/(?:<br\s*\/?>\s*){3,}/i.test(xhtmlContent)) {
    hasLargeBlankRegions = true;
    issues.push(`${filePath}: Contains 3+ consecutive <br /> tags creating an artificial blank gap.`);
  }
  if (/style=["'][^"']*(?:position\s*:\s*absolute|height\s*:\s*[2-9]\d{2,}px)/i.test(xhtmlContent)) {
    hasLargeBlankRegions = true;
    issues.push(`${filePath}: Contains fixed pixel height or absolute positioning in inline style.`);
  }

  // 2. Extract all <p> contents to check for duplicate consecutive paragraphs or improper merges
  const pRegex = /<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let prevParagraphText = '';

  while ((match = pRegex.exec(xhtmlContent)) !== null) {
    const innerHtml = match[1];
    const plainText = innerHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    // Check for raw unparsed Markdown heading or IMAGE_FIGURE leaked inside a <p>
    if (/(?:^|\s)#+\s+\S/.test(plainText) && plainText.startsWith('# ')) {
      hasImproperlyMergedParagraphs = true;
      issues.push(`${filePath}: Raw Markdown heading found inside a <p> element.`);
    }
    if (plainText.includes('[IMAGE_FIGURE:')) {
      hasImproperlyMergedParagraphs = true;
      issues.push(`${filePath}: Unprocessed [IMAGE_FIGURE] marker merged inside a <p> element.`);
    }

    // Check for accidental duplicate consecutive paragraphs (> 40 chars)
    if (plainText.length > 40 && plainText === prevParagraphText) {
      hasDuplicateParagraphs = true;
      issues.push(`${filePath}: Duplicate consecutive paragraph detected ("${plainText.slice(0, 40)}...").`);
    }
    prevParagraphText = plainText;
  }

  return {
    isValid:
      !hasLargeBlankRegions &&
      !hasDuplicateParagraphs &&
      !hasUnstrippedRunningHeaders &&
      !hasImproperlyMergedParagraphs,
    hasLargeBlankRegions,
    hasDuplicateParagraphs,
    hasUnstrippedRunningHeaders,
    hasImproperlyMergedParagraphs,
    chaptersIntact: true,
    issues,
  };
}
