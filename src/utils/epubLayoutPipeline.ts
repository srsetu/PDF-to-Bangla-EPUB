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
  BoundaryDecisionType,
  BoundaryReconstructionDiagnostic,
  ContinuationConfidence,
  EpubTocItem,
  LayoutCleanupReport,
  PageBoundaryMergeDecision,
  PageFigure,
  PageItem,
  PdfOutlineItem,
  PdfTextBlock,
  ReconstructionConfidenceLevel,
  SmartSpacingBoundaryClassification,
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

    const nonEmptyLines = lines.map((l) => l.trim()).filter((l) => l.length > 0);
    const nonEmptyCount = nonEmptyLines.length;
    const dashNumberLineCount = nonEmptyLines.filter(
      (l) => /[\-–—]\s*[^|]*[০-৯0-9]{1,4}\s*$/.test(l) && !/(?:পৃষ্ঠা|পেজ|page|ফর্মা|\|)/i.test(l)
    ).length;
    const isDashNumberListPage = dashNumberLineCount >= 2;

    const isDashListEntry = (line: string) =>
      isDashNumberListPage &&
      /[\-–—]\s*[^|]*[০-৯0-9]{1,4}\s*$/.test(line.trim()) &&
      !/(?:পৃষ্ঠা|পেজ|page|ফর্মা|\|)/i.test(line.trim());

    const lastLineIsArtifact =
      lastNonEmptyIdx !== -1 &&
      !isToc &&
      !isDashListEntry(lines[lastNonEmptyIdx]) &&
      isPageBoundaryArtifactLine(lines[lastNonEmptyIdx], 'bottom', bookDetails);
    const bodyLineCount = lastLineIsArtifact ? nonEmptyCount - 1 : nonEmptyCount;

    const filteredLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (i === firstNonEmptyIdx && trimmed) {
        const sig = normalizeHeaderFooterSignature(trimmed);
        const lastWord = (trimmed.split(/\s+/).pop() || '').toLowerCase();
        const isRepeatedTopHeader =
          bodyLineCount >= 2 &&
          !isDashListEntry(raw) &&
          !trimmed.startsWith('#') &&
          trimmed.length <= 55 &&
          (topSignatureCounts.get(sig) || 0) >= 2 &&
          !/[।॥.?!]$/.test(trimmed) &&
          !INCOMPLETE_ENDING_WORDS.has(lastWord);

        const isTopArtifact =
          idx > 0 &&
          !isToc &&
          !isDashListEntry(raw) &&
          isPageBoundaryArtifactLine(raw, 'top', bookDetails);

        // Also detect a single-occurrence running header (e.g. repeating chapter title or "ভূমিকা" with/without page number)
        // when the previous page ended mid-sentence and the second line of this page continues that sentence
        let isSingleRunningHeaderBeforeContinuation = false;
        if (
          idx > 0 &&
          !isToc &&
          bodyLineCount >= 2 &&
          !trimmed.startsWith('#') &&
          !/^<h[1-6]/i.test(trimmed) &&
          trimmed.length <= 45 &&
          !/[।॥.?!]\s*['"”’)\]]*$/.test(trimmed)
        ) {
          const prevPage = pages[idx - 1];
          const prevLines = (prevPage?.markdown || '')
            .split('\n')
            .map((l) => l.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);
          // Find last non-artifact line on prevPage
          let prevLastBodyLine = prevLines[prevLines.length - 1] || '';
          if (
            prevLines.length >= 2 &&
            isPageBoundaryArtifactLine(prevLastBodyLine, 'bottom', bookDetails)
          ) {
            prevLastBodyLine = prevLines[prevLines.length - 2];
          }
          const prevEndedMidSentence =
            prevLastBodyLine.length > 0 &&
            !/[।॥.?!:]\s*['"”’)\]]*$/.test(prevLastBodyLine);
          if (prevEndedMidSentence) {
            const normTop = trimmed
              .replace(/<[^>]+>/g, '')
              .replace(/[০-৯0-9\-–—|.\s]+/g, ' ')
              .trim();
            const normChap = (page.chapterTitle || prevPage?.chapterTitle || '').trim();
            if (
              (normChap.length >= 2 && normTop === normChap) ||
              /^(?:ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উপসংহার|পরিশিষ্ট)$/.test(normTop)
            ) {
              isSingleRunningHeaderBeforeContinuation = true;
            }
          }
        }

        if (isRepeatedTopHeader || isTopArtifact || isSingleRunningHeaderBeforeContinuation) {
          removedCount++;
          if (removedSamples.length < 10) removedSamples.push(trimmed);
          continue;
        }
      }

      if (i === lastNonEmptyIdx && i !== firstNonEmptyIdx && trimmed) {
        const sig = normalizeHeaderFooterSignature(trimmed);
        const lastWord = (trimmed.split(/\s+/).pop() || '').toLowerCase();
        const isRepeatedBottomFooter =
          bodyLineCount >= 2 &&
          !isDashListEntry(raw) &&
          !trimmed.startsWith('#') &&
          trimmed.length <= 55 &&
          (bottomSignatureCounts.get(sig) || 0) >= 2 &&
          !/[।॥.?!]$/.test(trimmed) &&
          !INCOMPLETE_ENDING_WORDS.has(lastWord);

        const isBottomArtifact =
          !isToc && !isDashListEntry(raw) && isPageBoundaryArtifactLine(raw, 'bottom', bookDetails);

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
 * Detects whether a block of text represents poetry, verse, or a multi-line stanza
 * with intentional line breaks that must never be merged into continuous prose.
 *
 * Uses multiple structural, prosodic, and contextual signals:
 * 1. Classic Bengali/Sanskrit verse markers (`॥`, `||`, numbered verse endings).
 * 2. Explicit poetic indentation or verse alignment classes.
 * 3. Multi-line rhythmic line-length distribution (supports both short-meter couplets
 *    and longer-meter *মুক্তক ছন্দ* where occasional lines reach up to 90 chars).
 * 4. Rhyming / cadence line endings across consecutive lines.
 * 5. Surrounding page context (`surroundingBlocks`): protects single-line orphan verses
 *    at the top or bottom of a page when adjacent blocks on the page are poetry stanzas.
 */
export function isPoetryOrVerseBlock(
  block: string,
  surroundingBlocks: string[] = []
): boolean {
  const trimmed = block.trim();
  if (!trimmed) return false;

  // Negative filter: Markdown headings, tables, figures, or TOC dot-leader lines are not poetry
  if (
    /^#{1,6}\s/.test(trimmed) ||
    trimmed.startsWith('|') ||
    trimmed.includes('[IMAGE_FIGURE:') ||
    /^!\[.*?\]\(.*?\)$/.test(trimmed)
  ) {
    return false;
  }

  // Signal 1: Double danda (॥) or numbered verse marker (e.g. ॥ ১ ॥)
  if (trimmed.includes('॥') || /\|\|/.test(trimmed)) return true;

  // Signal 2: Explicit verse/indentation wrapper class
  if (/\b(?:verse-line|verse-stanza|indent-line)\b/i.test(trimmed)) return true;

  // Negative filter: Explicit prose paragraph alignment/indent classes from OCR
  if (/class=["'][^"']*\b(?:text-left|text-justify|indent-1|indent-2)\b/i.test(trimmed)) {
    return false;
  }

  const rawLines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const cleanLines = rawLines
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);

  if (cleanLines.length >= 2) {
    // Guard against 2-line soft-wrapped prose paragraphs where line 1 is a long unpunctuated prose line
    if (
      cleanLines.length === 2 &&
      cleanLines[0].length >= 56 &&
      !/[,;।॥!?—–-]\s*['"”’)\]]*$/.test(cleanLines[0])
    ) {
      return false;
    }

    // Signal 3a: All lines are short rhythmic verse lines (4..56 chars, or 4..68 chars for 3+ line stanzas)
    const maxShortLen = cleanLines.length >= 3 ? 68 : 56;
    const allShortVerseLines = cleanLines.every((l) => l.length >= 4 && l.length <= maxShortLen);
    if (allShortVerseLines) {
      return true;
    }

    // Signal 3b: Multi-line stanza (3+ lines) with flexible meter (e.g. মুক্তক ছন্দ or long-meter verse)
    // Average line length <= 72, max line length <= 92, and >= 75% of lines <= 78 chars
    const lengths = cleanLines.map((l) => l.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    const shortRatio = lengths.filter((len) => len <= 78).length / lengths.length;

    if (cleanLines.length >= 3 && minLen >= 4 && avgLen <= 72 && maxLen <= 92 && shortRatio >= 0.75) {
      return true;
    }

    // Signal 3c: Indented verse lines (2+ lines starting with 2+ leading spaces or tabs)
    const indentedCount = rawLines.filter((l) => /^(?: {2,}|\t)/.test(l)).length;
    if (indentedCount >= 2 && avgLen <= 85) {
      return true;
    }
  }

  // Signal 4: Single-line orphan verse at a page boundary surrounded by confirmed multi-line poetry stanzas
  if (cleanLines.length === 1 && surroundingBlocks.length > 0) {
    const singleLine = cleanLines[0];
    // Orphan single verse line must be short (4..42 chars, or up to 54 chars if ending with verse/clause punctuation)
    const endsWithVersePunct = /[,;।॥!?—–-]\s*['"”’)\]]*$/.test(singleLine);
    const maxOrphanLen = endsWithVersePunct ? 54 : 42;
    if (singleLine.length >= 4 && singleLine.length <= maxOrphanLen) {
      const otherBlocks = surroundingBlocks.filter((b) => b && b.trim() !== trimmed);
      // Require at least one confirmed multi-line poetry stanza among surrounding blocks
      const hasAdjacentPoetryStanza = otherBlocks.some((b) => {
        const bLines = b
          .trim()
          .split('\n')
          .filter((l) => l.trim().length > 0);
        return bLines.length >= 2 && isPoetryOrVerseBlock(b, []);
      });
      if (hasAdjacentPoetryStanza) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Lyrical & poetic lexicon cues frequently appearing in Bengali prose poetry (গদ্যকবিতা)
 * when combined with rhythmic cadence, anaphora, or short clause structure.
 */
const BENGALI_LYRICAL_PROSE_POETRY_CUES = new Set([
  'হৃদয়', 'হৃদয়', 'আকাশ', 'অন্ধকার', 'নির্জন', 'নির্জনতা', 'নীরব', 'নীরবতা', 'অনন্ত', 'অসীম',
  'স্বপ্ন', 'বিষণ্ণ', 'বাঁশি', 'জ্যোৎস্না', 'ঝড়', 'ঝড়', 'মেঘ', 'নক্ষত্র', 'তারা', 'দীর্ঘশ্বাস',
  'কুয়াশা', 'কুয়াশা', 'বেদনা', 'অশ্রু', 'বিরহ', 'দিগন্ত', 'ছায়া', 'ছায়া', 'সুর', 'ছন্দ',
  'গোধূলি', 'শ্রাবণ', 'ফাল্গুন', 'বসন্ত', 'শরৎ', 'রাত্রি', 'রজনী', 'প্রভাত', 'আলোছায়া', 'স্তব্ধ',
]);

/**
 * Detects whether a full-width paragraph block is unmarked prose poetry (গদ্যকবিতা)
 * or has ambiguous lyrical/poetic cadence that must NOT be flattened across page boundaries.
 *
 * Signals analyzed:
 * 1. Line-break patterns (multi-line long verses > 72 chars that exceed traditional verse-line thresholds).
 * 2. Sentence length and rhythm (3+ short rhythmic clauses/sentences averaging <= 8.5 words).
 * 3. High density of lyrical internal pauses (`—`, `;`, `...`, `!`, `?`).
 * 4. Stylistic repetition / anaphora / refrain (repeated clause openings or endings).
 * 5. Surrounding literary or poetic context (`bookDetails?.genre` or adjacent poetry stanzas).
 * 6. Layout geometry (`layoutBlocks` showing irregular right margins or wide stanza spacing).
 */
export function isUnmarkedProsePoetryBlock(
  block: string,
  surroundingBlocks: string[] = [],
  options: {
    bookDetails?: BookDetails;
    layoutBlocks?: PdfTextBlock[];
  } = {}
): {
  isProsePoetry: boolean;
  isAmbiguous: boolean;
  signals: string[];
} {
  const trimmed = block.trim();
  if (!trimmed) {
    return { isProsePoetry: false, isAmbiguous: false, signals: [] };
  }

  // Negative filter: headings, tables, figures, lists
  if (
    /^#{1,6}\s/.test(trimmed) ||
    trimmed.startsWith('|') ||
    trimmed.includes('[IMAGE_FIGURE:') ||
    /^[-*•+]\s+/.test(trimmed) ||
    /^[০-৯0-9]+[.)]\s+/.test(trimmed)
  ) {
    return { isProsePoetry: false, isAmbiguous: false, signals: [] };
  }

  const cleanText = trimmed.replace(/<[^>]+>/g, '').trim();
  const words = cleanText.split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return { isProsePoetry: false, isAmbiguous: false, signals: [] };
  }

  const signals: string[] = [];

  // Negative filter: Explicit prose paragraph classes from OCR
  const hasExplicitProseClass = /class=["'][^"']*\b(?:text-left|text-justify|indent-1|indent-2)\b/i.test(
    trimmed
  );

  // 1. Multi-line long-format prose-poetry lines (3+ lines, or 2 lines where both end with lyrical/sentence punctuation)
  const rawLines = trimmed
    .split('\n')
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (
    !hasExplicitProseClass &&
    rawLines.length >= 2 &&
    rawLines.every((l) => l.length >= 12 && l.length <= 140) &&
    (rawLines.length >= 3 ||
      (/[।॥,;:!?—–…]\s*['"”’)\]]*$/.test(rawLines[0]) &&
        /[।॥,;:!?—–…]\s*['"”’)\]]*$/.test(rawLines[1])))
  ) {
    signals.push('multi_line_prose_poetry_cadence');
  }

  // 2. Sentence / clause rhythm: split by danda, double danda, exclamation, question, ellipsis, or em-dash
  const clauses = cleanText
    .split(/(?:[।॥!?]+|\.{3}|…|[—–])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (clauses.length >= 3) {
    const clauseWordCounts = clauses.map((c) => c.split(/\s+/).filter(Boolean).length);
    const avgClauseWords = clauseWordCounts.reduce((a, b) => a + b, 0) / clauseWordCounts.length;
    if (avgClauseWords >= 2 && avgClauseWords <= 8.5) {
      signals.push('rhythmic_short_clause_cadence');
    }

    // 3. Anaphora / stylistic repetition: check if 2+ clauses or lines begin with the same Bengali word
    const openingWords = clauses
      .map((c) => (c.match(/^([\u0980-\u09FF]{2,})/) || [])[1])
      .filter(Boolean);
    const openingCounts = new Map<string, number>();
    for (const w of openingWords) {
      openingCounts.set(w, (openingCounts.get(w) || 0) + 1);
    }
    if ([...openingCounts.values()].some((cnt) => cnt >= 2)) {
      signals.push('anaphoric_parallel_clause_openings');
    }

    // Check refrain / repeated clause endings
    const closingWords = clauses
      .map((c) => (c.match(/([\u0980-\u09FF]{2,})\s*$/) || [])[1])
      .filter(Boolean);
    const closingCounts = new Map<string, number>();
    for (const w of closingWords) {
      closingCounts.set(w, (closingCounts.get(w) || 0) + 1);
    }
    if ([...closingCounts.values()].some((cnt) => cnt >= 2)) {
      signals.push('refrain_parallel_clause_endings');
    }
  }

  // 4. High density of lyrical internal pauses (em-dashes, semicolons, ellipses, exclamations)
  const pauseMatches = cleanText.match(/[—–;!?…]|\.{3}/g) || [];
  if (pauseMatches.length >= 3 && words.length <= 75) {
    signals.push('high_lyrical_pause_density');
  }

  // 5. Lyrical / vocative Bengali vocabulary density
  let lyricalWordMatches = 0;
  for (const w of words) {
    const strippedW = w.replace(/[।॥,;:!?'"“”‘’()—–-]/g, '');
    if (BENGALI_LYRICAL_PROSE_POETRY_CUES.has(strippedW)) {
      lyricalWordMatches++;
    }
  }
  const hasVocativeOpening = /^(?:হে\s|ওগো\s|হায়\s|হায়\s|রে\s|সখি\s|বন্ধু\s)/.test(cleanText);
  if (lyricalWordMatches >= 2 || (lyricalWordMatches >= 1 && hasVocativeOpening)) {
    signals.push('lyrical_vocabulary_and_vocative_tone');
  }

  // 6. Surrounding literary / poetic context
  const genreText = `${options.bookDetails?.genre || ''} ${options.bookDetails?.title || ''}`.toLowerCase();
  const isPoetryGenre = /(?:কবিতা|কাব্য|গদ্যকবিতা|গীতিকবিতা|ছড়া|ছড়া|poetry|poem|verse)/i.test(genreText);
  const otherBlocks = surroundingBlocks.filter((b) => b && b.trim() !== trimmed);
  const hasSurroundingVerse = otherBlocks.some((b) => isPoetryOrVerseBlock(b, []));

  if (isPoetryGenre || hasSurroundingVerse) {
    signals.push('surrounding_poetic_context');
  }

  // 7. Layout geometry evidence (irregular right margin / wide vertical spacing)
  if (options.layoutBlocks && options.layoutBlocks.length >= 2) {
    const widths = options.layoutBlocks.map((b) => b.width).filter((w) => w > 0);
    if (widths.length >= 2) {
      const maxW = Math.max(...widths);
      const minW = Math.min(...widths);
      if (maxW - minW >= 50) {
        signals.push('geometry_ragged_poetic_margins');
      }
    }
  }

  // Strong unmarked prose poetry requires >= 2 distinct signals (with at least one structural/cadence/repetition signal)
  const hasStructuralCadenceSignal = signals.some(
    (s) =>
      s === 'multi_line_prose_poetry_cadence' ||
      s === 'rhythmic_short_clause_cadence' ||
      s === 'anaphoric_parallel_clause_openings' ||
      s === 'refrain_parallel_clause_endings' ||
      s === 'high_lyrical_pause_density'
  );

  if (signals.length >= 2 && hasStructuralCadenceSignal) {
    return { isProsePoetry: true, isAmbiguous: false, signals };
  }

  if (signals.length >= 1 && (hasStructuralCadenceSignal || isPoetryGenre || hasSurroundingVerse)) {
    return { isProsePoetry: false, isAmbiguous: true, signals };
  }

  return { isProsePoetry: false, isAmbiguous: false, signals };
}

/**
 * Checks whether a block of text is a structural non-prose element that must NEVER
 * be merged with an adjacent paragraph, and identifies its structural category.
 */
export function isStructuralNonMergeBlock(
  block: string,
  surroundingBlocks: string[] = [],
  options: { bookDetails?: BookDetails; layoutBlocks?: PdfTextBlock[] } = {}
): {
  isNonMerge: boolean;
  reason?: string;
  structuralKind?: 'NEW_CHAPTER' | 'NEW_HEADING' | 'STRUCTURED_CONTENT';
} {
  const trimmed = block.trim();
  if (!trimmed) return { isNonMerge: true, reason: 'empty_block', structuralKind: 'STRUCTURED_CONTENT' };

  // 1a. Top-level Chapter or Part Heading (# Heading, <h1>, or Chapter/Part keyword)
  if (
    /^#\s+\S/.test(trimmed) ||
    /^<h1[\s>]/i.test(trimmed) ||
    /^(?:Part|Volume|Book|Act|Chapter)\s+[IVXLCDM\d]+/i.test(trimmed) ||
    /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়))\b/i.test(
      trimmed.replace(/^[#*<\s]+/, '')
    )
  ) {
    return { isNonMerge: true, reason: 'chapter_boundary', structuralKind: 'NEW_CHAPTER' };
  }

  // 1b. Subheading (##..######, <h2>..<h6>, Section/Scene keyword)
  if (
    /^#{2,6}\s+\S/.test(trimmed) ||
    /^<h[2-6][\s>]/i.test(trimmed) ||
    /^(?:Section|Scene)\s+[IVXLCDM\d]+/i.test(trimmed) ||
    /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|[০-৯\d]+)\s*(?:পরিচ্ছেদ|দৃশ্য))\b/i.test(
      trimmed.replace(/^[#*<\s]+/, '')
    )
  ) {
    return { isNonMerge: true, reason: 'heading_boundary', structuralKind: 'NEW_HEADING' };
  }

  // 2. Section divider / horizontal rule
  if (
    /^[-=_]{3,}$/.test(trimmed) ||
    /^(\*\s*\*\s*\*|•••|•\s*•\s*•|—\s*—\s*—)$/.test(trimmed) ||
    /^<hr\b/i.test(trimmed) ||
    trimmed.includes('section-divider')
  ) {
    return { isNonMerge: true, reason: 'section_divider', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 3. Image / Figure / Markdown Image / Caption
  if (
    trimmed.includes('[IMAGE_FIGURE:') ||
    /^!\[.*?\]\(.*?\)$/.test(trimmed) ||
    /^<(?:figure|img|figcaption)\b/i.test(trimmed) ||
    /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*[০-৯0-9:.]/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'figure_or_caption', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 4. Table row or HTML table
  if (
    (trimmed.startsWith('|') && trimmed.endsWith('|')) ||
    /^<(?:table|thead|tbody|tr|td|th)\b/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'table_element', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 5. Unordered or Ordered List item
  if (
    /^[-*•+]\s+/.test(trimmed) ||
    /^[০-৯0-9]+[.)]\s+/.test(trimmed) ||
    /^[\(\[][ক-ঞa-zA-ZivxIVX]+[\)\]]\s+/.test(trimmed) ||
    /^<(?:ul|ol|li)\b/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'list_item', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 6. Blockquote
  if (trimmed.startsWith('> ') || /^<blockquote\b/i.test(trimmed)) {
    return { isNonMerge: true, reason: 'blockquote', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 7. Footnote
  if (trimmed.startsWith('[^') || /^<p\s+class=["']footnote["']/i.test(trimmed)) {
    return { isNonMerge: true, reason: 'footnote', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 8. Center-aligned or Right-aligned block (poetry, dedication, signature, date)
  if (
    /^(?:<center>|\[center\]|->|\[right\])/i.test(trimmed) ||
    /(?:text-center|text-right|align=["'](?:center|right)["'])/i.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'aligned_special_block', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 9a. Poetry / Verse stanza (with optional surrounding page context)
  if (isPoetryOrVerseBlock(trimmed, surroundingBlocks)) {
    return { isNonMerge: true, reason: 'poetry_or_verse', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 9b. Unmarked Prose Poetry (গদ্যকবিতা) with full-width margins
  const prosePoetryCheck = isUnmarkedProsePoetryBlock(trimmed, surroundingBlocks, options);
  if (prosePoetryCheck.isProsePoetry) {
    return { isNonMerge: true, reason: 'unmarked_prose_poetry', structuralKind: 'STRUCTURED_CONTENT' };
  }

  // 10. Standalone bold subheading line
  if (
    (/^\*\*[^*]+\*\*$/.test(trimmed) || /^<strong>[^<]+<\/strong>$/i.test(trimmed)) &&
    trimmed.length <= 80 &&
    !/[।॥.?!]\s*(?:\*\*|<\/strong>)$/.test(trimmed)
  ) {
    return { isNonMerge: true, reason: 'standalone_bold_subheading', structuralKind: 'NEW_HEADING' };
  }

  return { isNonMerge: false };
}

/**
 * Known Bengali compound second-members (দ্বন্দ্ব ও তৎপুরুষ সমাস) where a hyphen between
 * two complete Bengali words is intentional and must NOT be stripped.
 */
const BENGALI_COMPOUND_SECOND_WORDS = new Set([
  'বাবা', 'মা', 'বোন', 'ভাই', 'রাত', 'দিন', 'সাহিত্য', 'সংস্কৃতি', 'ইতিহাস', 'বিজ্ঞান',
  'বাণিজ্য', 'কল্যাণ', 'বিরোধী', 'ভিত্তিক', 'মুক্ত', 'যুক্ত', 'দুঃখ', 'সুখ', 'মন্দ', 'ভালো',
  'বড়', 'বড়', 'ছোট', 'যাওয়া', 'যাওয়া', 'আসা', 'বিদেশ', 'দেশ', 'পা', 'হাত', 'প্রাণ', 'মন',
  'মরণ', 'জীবন', 'নজরুল', 'ঠাকুর', 'পশ্চিম', 'পূর্ব', 'দক্ষিণ', 'উত্তর', 'প্রদান', 'আদান',
  'দেন', 'লেন', 'কান্না', 'হাসি', 'পুণ্য', 'পাপ', 'মিথ্যা', 'সত্য', 'আলো', 'অন্ধকার', 'জল',
  'স্থল', 'আকাশ', 'পাতাল', 'নারী', 'পুরুষ', 'শিশু', 'বৃদ্ধ', 'ধনী', 'দরিদ্র', 'শহর', 'গ্রাম',
]);

/**
 * Standalone Bengali words that must NEVER be concatenated across an unhyphenated
 * page boundary even if their concatenation happens to form a valid compound word
 * (e.g., "বাংলা" + "ভাষা" -> keep "বাংলা ভাষা", "নদী" + "তীরে" -> keep "নদী তীরে",
 * "মানুষ" + "জন" -> keep "মানুষ জন", "দেশ" + "কাল" -> keep "দেশ কাল").
 */
const STANDALONE_BENGALI_WORDS = new Set([
  ...BENGALI_COMPOUND_SECOND_WORDS,
  ...INCOMPLETE_ENDING_WORDS,
  'বাংলা', 'বাঙালি', 'বাঙ্গালী', 'ভাষা', 'দেশ', 'কাল', 'মানুষ', 'জন', 'জনগণ', 'নদী', 'তীর', 'তীরে',
  'বন', 'ভূমি', 'জল', 'ধারা', 'পথ', 'ঘাট', 'ঘর', 'বাড়ি', 'বাড়ি', 'জীবন', 'যাত্রা', 'সমাজ', 'নীতি',
  'শিল্প', 'কর্ম', 'কথা', 'বার্তা', 'গান', 'বাজনা', 'আলো', 'ছায়া', 'ছায়া', 'ভালো', 'বাসা', 'রাজ',
  'যুদ্ধ', 'ক্ষেত্র', 'তথ্য', 'প্রযুক্তি', 'শিক্ষা', 'ব্যবস্থা', 'হাতে', 'কলমে', 'মনে', 'প্রাণে', 'চোখে', 'মুখে',
  'বই', 'পত্র', 'খাতা', 'কলম', 'ফুল', 'ফল', 'পাখি', 'গাছ', 'পালা', 'মাঠ', 'ময়দান', 'ময়দান', 'সাগর', 'পাহাড়', 'পাহাড়',
  'সূর্য', 'চাঁদ', 'তারা', 'মেঘ', 'বৃষ্টি', 'হাওয়া', 'হাওয়া', 'বাতাস', 'আগুন', 'মাটি', 'পাথর', 'সোনা', 'রুপা',
  'রবীন্দ্রনাথ', 'নজরুল', 'শরৎচন্দ্র', 'বঙ্কিমচন্দ্র', 'জীবনানন্দ', 'সুকান্ত', 'মানিক', 'তারাশঙ্কর', 'বিভূতিভূষণ',
  'কবিতা', 'উপন্যাস', 'গল্প', 'নাটক', 'প্রবন্ধ', 'ছন্দ', 'সুর', 'তাল', 'লয়', 'লয়', 'রাগ', 'রাগিণী',
  'সময়', 'সময়', 'সকাল', 'দুপুর', 'বিকেল', 'সন্ধ্যা', 'রাত্রি', 'বছর', 'মাস', 'সপ্তাহ', 'আজ', 'কাল', 'পরশু',
  'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ', 'শত', 'হাজার', 'লক্ষ', 'কোটি',
  'আমি', 'আমরা', 'তুমি', 'তোমরা', 'সে', 'তারা', 'তিনি', 'তাঁরা', 'আপনি', 'আপনারা', 'এই', 'সেই', 'ওই', 'কোন', 'কোনো',
  'সব', 'সকল', 'সমস্ত', 'অনেক', 'কিছু', 'কত', 'যত', 'তত', 'এত', 'কেন', 'কেমন', 'কোথায়', 'কোথায়', 'কখন',
  'আছে', 'নেই', 'নাই', 'হয়', 'হয়', 'হলো', 'হল', 'হবে', 'করে', 'করেন', 'করল', 'করবে', 'বলে', 'বলেন', 'বলল',
  'দেয়', 'দেয়', 'দিল', 'নেয়', 'নেয়', 'নিল', 'যায়', 'যায়', 'গেল', 'আসে', 'এল', 'এলো', 'থাকে', 'থাকল',
]);

/**
 * Bound Bengali suffixes, case endings (বিভক্তি/প্রত্যয়), and word-completion fragments
 * that NEVER occur as independent standalone words at the beginning of a clause/page.
 * When a page ends mid-sentence with a valid stem and the next page starts with one of
 * these bound fragments (and their concatenation is a valid Bengali word), it is strong
 * morphological evidence of an unhyphenated split word across a page boundary.
 */
const BOUND_BENGALI_WORD_ENDINGS = new Set([
  'তিক', 'থের', 'দের', 'দেরকে', 'দেরই', 'গুলোর', 'গুলিকে', 'গুলোতে', 'গুলোকে', 'গুলোও',
  'লয়ের', 'লয়ের', 'নের', 'তির', 'ণীর', 'বীর', 'কালীন', 'মূলক', 'জনিত', 'ভিত্তিক',
  'মণ্ডলী', 'করণের', 'শীলতা', 'যোগ্যতা', 'কেন্দ্রিক', 'তান্ত্রিক', 'ভাবাপন্ন', 'ানুযায়ী', 'ানুসারে',
]);

/**
 * Known non-standalone incomplete Bengali word stems frequently produced when a long
 * polymorphic word is split across a PDF page/line boundary without a hyphen.
 */
const INCOMPLETE_BENGALI_WORD_PREFIXES = new Set([
  'আন্তর্জা', 'রবীন্দ্রনা', 'বিশ্ববিদ্যা', 'সংস্কৃ', 'পরিবর্ত', 'গণতান্ত্রি', 'অর্থনৈ', 'রাজনৈ',
  'সামাজি', 'ঐতিহাসি', 'বৈজ্ঞানি', 'আধ্যাত্মি', 'মানসি', 'প্রাকৃতি', 'সাংস্কৃতি', 'আনুষ্ঠানিক',
  'প্রয়োজনী', 'প্রয়োজনী', 'সহযোগি', 'সহানুভূ', 'অভিধা', 'অনুষ্ঠা', 'পরিচাল', 'উত্তরাধি',
  'মনোবিজ্ঞা', 'দার্শনি', 'প্রযুক্তিবি', 'সাহিত্যি', 'সাংবাদি', 'স্বাভাবি', 'আপেক্ষি', 'তাৎক্ষণি',
]);

/**
 * Canonical multi-syllable Bengali words verified for high-confidence cross-page reconstruction
 * when split into non-standalone morphological constituents.
 */
const VERIFIED_SPLITTABLE_BENGALI_WORDS = new Set([
  'আন্তর্জাতিক', 'রবীন্দ্রনাথের', 'রবীন্দ্রনাথ', 'বিশ্ববিদ্যালয়', 'বিশ্ববিদ্যালয়', 'বিশ্ববিদ্যালয়ের', 'বিশ্ববিদ্যালয়ের',
  'সাহিত্যিকদের', 'সাহিত্যিক', 'সংস্কৃতির', 'সংস্কৃতি', 'পরিবর্তনের', 'পরিবর্তন', 'প্রতিষ্ঠানের', 'প্রতিষ্ঠান',
  'গণতান্ত্রিক', 'অর্থনৈতিক', 'রাজনৈতিক', 'সামাজিক', 'ঐতিহাসিক', 'বৈজ্ঞানিক', 'আধ্যাত্মিক',
  'মানসিক', 'প্রাকৃতিক', 'সাংস্কৃতিক', 'আনুষ্ঠানিকতা', 'প্রয়োজনীয়', 'প্রয়োজনীয়', 'সহযোগিতা',
  'সহানুভূতি', 'সহানুভূতির', 'অভিধানের', 'অনুষ্ঠানের', 'পরিচালনার', 'পরিচালনা', 'উত্তরাধিকার',
  'মনোবিজ্ঞানের', 'মনোবিজ্ঞান', 'দার্শনিক', 'প্রযুক্তিবিদ্যা', 'সাংবাদিকদের', 'সাংবাদিক', 'স্বাভাবিক',
  'আপেক্ষিক', 'তাৎক্ষণিক', 'মানবিকতা', 'মানবিকতার', 'সৃজনশীলতা', 'গ্রহণযোগ্যতা',
]);

export interface BengaliFragmentAnalysis {
  hasTrailingHyphen: boolean;
  hasTrailingBareHasanta: boolean;
  hasLeadingOrphanedMark: boolean;
  isKnownCompoundOrReduplicated: boolean;
  isUnhyphenatedSplitWord?: boolean;
  canJoinWord: boolean;
  isAmbiguousFragment: boolean;
  wordConfidenceLevel?: ReconstructionConfidenceLevel;
  proposedWordReconstruction?: string;
  joinedText?: string;
  safeSpaceSeparatedText: string;
  reason: string;
}

/**
 * Analyzes Bengali and English tokens at a page/line boundary to separate the decision
 * to remove a visual page gap from the decision to join or modify boundary words.
 *
 * Rules:
 * - Never joins two standalone Bengali words merely because their concatenation forms a valid compound word.
 * - Never guesses conjuncts when a line/page ends with a bare hasanta (্, \u09CD) or starts
 *   with an orphaned vowel sign / combining mark ([\u0981-\u0983\u09BC\u09BE-\u09CC\u09CD\u09D7]).
 * - Preserves intentional hyphens in Bengali compound words (e.g. সুখ-দুঃখ, দেশ-বিদেশ)
 *   and reduplicated words (e.g. ধীরে-ধীরে, বারে-বারে).
 * - Joins hyphen-split words ONLY when linguistic and Unicode orthographic validation succeeds.
 * - Reconstructs unhyphenated cross-page split Bengali words ONLY at HIGH confidence when
 *   morphological/lexicon/geometry evidence proves the fragments are a split word rather than two standalone words.
 */
/**
 * Normalizes the boundary when merging two paragraph fragments into a single continuous paragraph:
 * 1. Unwraps inner `</p>` and `<p...>` tags if the fragments were already HTML-wrapped so they become a single `<p>...</p>`.
 * 2. Strips redundant artificial page-boundary quotation marks when a single quoted sentence was wrapped in `“...”` on both pages without terminal punctuation before the closing quote.
 * 3. Collapses duplicate whitespace at the join point into a single normalized space (or joins directly for split words).
 */
export function normalizeMergedParagraphBoundary(
  firstSegment: string,
  secondSegment: string,
  joinWithoutSpace: boolean = false
): string {
  let left = firstSegment.trimEnd();
  let right = secondSegment.trimStart();
  if (!left || !right) return left || right;

  // 1. Handle HTML <p...> / <div...> wrappers symmetrically or asymmetrically so merged text never contains inner </p><p> breaks
  const leftStartsWithP = /^<p(?:\s[^>]*)?>/i.test(left);
  const leftEndsWithP = /<\/p>\s*$/i.test(left);
  const rightStartsWithP = /^<p(?:\s[^>]*)?>/i.test(right);
  const rightEndsWithP = /<\/p>\s*$/i.test(right);

  let outerOpenTag = '';
  let outerCloseTag = '';

  if (leftStartsWithP || rightStartsWithP || leftEndsWithP || rightEndsWithP) {
    const openMatch = left.match(/^(<p(?:\s[^>]*)?>)/i);
    if (openMatch && (leftEndsWithP || rightEndsWithP)) {
      outerOpenTag = openMatch[1];
      outerCloseTag = '</p>';
    }
    left = left.replace(/^<p(?:\s[^>]*)?>/i, '').replace(/<\/p>\s*$/i, '').trimEnd();
    right = right.replace(/^<p(?:\s[^>]*)?>/i, '').replace(/<\/p>\s*$/i, '').trimStart();
  }

  // Collapse soft single-newline line wraps inside a merged prose paragraph so markdownToXhtml emits one single <p>
  left = left.replace(/\s*\n+\s*/g, ' ').trimEnd();
  right = right.replace(/\s*\n+\s*/g, ' ').trimStart();

  // 2. If left ends with a closing quote without terminal punctuation before it (e.g. “...রহস্য”)
  // and right starts with an opening quote (e.g. “উন্মোচন করবে...”), strip the redundant inner boundary quotes
  const cleanLeftCheck = left.replace(/<[^>]+>/g, '').trim();
  const cleanRightCheck = right.replace(/<[^>]+>/g, '').trim();
  if (
    /[^।॥.?!\s]\s*['"”’]$/.test(cleanLeftCheck) &&
    /^['"“‘]/.test(cleanRightCheck)
  ) {
    left = left.replace(/['"”’](\s*(?:<\/[^>]+>\s*)*)$/, '$1').trimEnd();
    right = right.replace(/^((?:<[^>]+>\s*)*)['"“‘]\s*/, '$1').trimStart();
  }

  const joinedCore = joinWithoutSpace
    ? `${left}${right}`
    : `${left.replace(/\s+$/, '')} ${right.replace(/^\s+/, '')}`;

  return outerOpenTag ? `${outerOpenTag}${joinedCore}${outerCloseTag}` : joinedCore;
}

export function analyzeBengaliBoundaryFragments(
  firstSegment: string,
  secondSegment: string,
  options: {
    allowUnhyphenatedCrossPageWordJoin?: boolean;
    layoutGeometryVerified?: boolean;
  } = {}
): BengaliFragmentAnalysis {
  const left = firstSegment.trimEnd();
  const right = secondSegment.trimStart();
  const safeSpaceSeparatedText =
    left && right ? normalizeMergedParagraphBoundary(left, right, false) : left || right;

  if (!left || !right) {
    return {
      hasTrailingHyphen: false,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      safeSpaceSeparatedText,
      reason: 'empty_boundary_segment',
    };
  }

  const cleanLeft = left.replace(/<[^>]+>/g, '').trimEnd();
  const cleanRight = right.replace(/<[^>]+>/g, '').trimStart();

  // 1. Check for trailing bare Bengali hasanta (্, \u09CD) at the end of the page
  const hasTrailingBareHasanta = /\u09CD\s*$/.test(cleanLeft);
  // 2. Check for orphaned combining mark / vowel sign at the start of the next page
  const hasLeadingOrphanedMark = /^[\u0981-\u0983\u09BC\u09BE-\u09CC\u09CD\u09D7]/.test(cleanRight);

  if (hasTrailingBareHasanta || hasLeadingOrphanedMark) {
    const leftLastToken = (cleanLeft.match(/([\u0980-\u09FF]+)\s*$/) || [])[1] || '';
    const rightFirstToken = (cleanRight.match(/^([\u0980-\u09FF]+)/) || [])[1] || '';
    return {
      hasTrailingHyphen: false,
      hasTrailingBareHasanta,
      hasLeadingOrphanedMark,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      proposedWordReconstruction:
        leftLastToken && rightFirstToken ? `${leftLastToken}${rightFirstToken}` : undefined,
      safeSpaceSeparatedText,
      reason: hasTrailingBareHasanta ? 'trailing_bare_hasanta' : 'leading_orphaned_combining_mark',
    };
  }

  // 3. Check for 1-character hyphenated fragment at the end of cleanLeft (e.g. "ক-")
  if (/(?:^|\s)[\u0980-\u09FFa-zA-Z][-‐‑]\s*$/.test(cleanLeft)) {
    return {
      hasTrailingHyphen: true,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      safeSpaceSeparatedText,
      reason: 'ambiguous_single_char_hyphen_fragment',
    };
  }

  // 4. Check for multi-character hyphenated token at the end of cleanLeft
  const hyphenMatch = cleanLeft.match(/([\u0980-\u09FFa-zA-Z]{2,})[-‐‑]\s*$/);
  if (!hyphenMatch) {
    // 5. Unhyphenated Cross-Page Bengali Word Split Analysis
    if (options.allowUnhyphenatedCrossPageWordJoin) {
      const leftTokenMatch = cleanLeft.match(/(?:^|\s)([\u0980-\u09FF]{2,})\s*$/);
      const rightTokenMatch = cleanRight.match(/^([\u0980-\u09FF]{2,})(?=\s|[।॥,;:!?'"”’)\]-]|$)/);

      if (leftTokenMatch && rightTokenMatch) {
        const leftToken = leftTokenMatch[1];
        const rightToken = rightTokenMatch[1];
        const candidateWord = leftToken + rightToken;

        const leftIsStandalone = STANDALONE_BENGALI_WORDS.has(leftToken);
        const rightIsStandalone = STANDALONE_BENGALI_WORDS.has(rightToken);

        // Rule A: Never merge if BOTH tokens are standalone Bengali words, even if their concatenation is a valid compound!
        if (leftIsStandalone && rightIsStandalone) {
          return {
            hasTrailingHyphen: false,
            hasTrailingBareHasanta: false,
            hasLeadingOrphanedMark: false,
            isKnownCompoundOrReduplicated: false,
            isUnhyphenatedSplitWord: false,
            canJoinWord: false,
            isAmbiguousFragment: false,
            wordConfidenceLevel: 'LOW',
            proposedWordReconstruction: isValidBengaliWord(candidateWord) ? candidateWord : undefined,
            safeSpaceSeparatedText,
            reason: 'standalone_words_kept_separate',
          };
        }

        // Rule B: High-Confidence Unhyphenated Split Word Reconstruction
        // Requires valid Bengali orthography AND positive morphological/lexicon proof
        if (isValidBengaliWord(candidateWord) && candidateWord.length >= 5 && candidateWord.length <= 22) {
          const isBoundRightSuffix =
            BOUND_BENGALI_WORD_ENDINGS.has(rightToken) && leftToken.length >= 3;
          const isIncompleteLeftPrefix =
            INCOMPLETE_BENGALI_WORD_PREFIXES.has(leftToken) &&
            VERIFIED_SPLITTABLE_BENGALI_WORDS.has(candidateWord);
          const isVerifiedSplittableWord =
            VERIFIED_SPLITTABLE_BENGALI_WORDS.has(candidateWord) &&
            (!leftIsStandalone || !rightIsStandalone);
          const isGeometryVerifiedSplit =
            Boolean(options.layoutGeometryVerified) &&
            (!leftIsStandalone || !rightIsStandalone) &&
            (VERIFIED_SPLITTABLE_BENGALI_WORDS.has(candidateWord) || BOUND_BENGALI_WORD_ENDINGS.has(rightToken));

          if (
            isBoundRightSuffix ||
            isIncompleteLeftPrefix ||
            isVerifiedSplittableWord ||
            isGeometryVerifiedSplit
          ) {
            const joinedFull = normalizeMergedParagraphBoundary(left, right, true);
            return {
              hasTrailingHyphen: false,
              hasTrailingBareHasanta: false,
              hasLeadingOrphanedMark: false,
              isKnownCompoundOrReduplicated: false,
              isUnhyphenatedSplitWord: true,
              canJoinWord: true,
              isAmbiguousFragment: false,
              wordConfidenceLevel: 'HIGH',
              proposedWordReconstruction: candidateWord,
              joinedText: joinedFull,
              safeSpaceSeparatedText,
              reason: isBoundRightSuffix
                ? 'reconstructed_unhyphenated_bound_suffix_word'
                : 'reconstructed_unhyphenated_verified_split_word',
            };
          }

          // Rule C: Medium-confidence suspected split word (e.g., an unrecognized non-standalone prefix)
          // Preserve original tokens separated by space and record candidate in diagnostics
          if (INCOMPLETE_BENGALI_WORD_PREFIXES.has(leftToken) || BOUND_BENGALI_WORD_ENDINGS.has(rightToken)) {
            return {
              hasTrailingHyphen: false,
              hasTrailingBareHasanta: false,
              hasLeadingOrphanedMark: false,
              isKnownCompoundOrReduplicated: false,
              isUnhyphenatedSplitWord: false,
              canJoinWord: false,
              isAmbiguousFragment: true,
              wordConfidenceLevel: 'MEDIUM',
              proposedWordReconstruction: candidateWord,
              safeSpaceSeparatedText,
              reason: 'medium_confidence_unverified_unhyphenated_split_preserved',
            };
          }
        }
      }

      // Check if page ends or starts with an isolated single-consonant or 1-akshara fragment without punctuation
      const singleCharTrailing = /(?:^|\s)([\u0995-\u09B9\u09DC-\u09DF][\u09BE-\u09CC]?)\s*$/.exec(cleanLeft);
      const rightWordStart = /^([\u0980-\u09FF]{2,})/.exec(cleanRight);
      if (
        singleCharTrailing &&
        rightWordStart &&
        !STANDALONE_BENGALI_WORDS.has(singleCharTrailing[1]) &&
        !['ও', 'এ', 'না', 'কি', 'কী', 'যে', 'সে', 'তা', 'বা', 'তো', 'গো', 'রে', 'যা'].includes(
          singleCharTrailing[1]
        )
      ) {
        const candidateSingleJoin = singleCharTrailing[1] + rightWordStart[1];
        return {
          hasTrailingHyphen: false,
          hasTrailingBareHasanta: false,
          hasLeadingOrphanedMark: false,
          isKnownCompoundOrReduplicated: false,
          isUnhyphenatedSplitWord: false,
          canJoinWord: false,
          isAmbiguousFragment: true,
          wordConfidenceLevel: 'MEDIUM',
          proposedWordReconstruction: candidateSingleJoin,
          safeSpaceSeparatedText,
          reason: 'ambiguous_short_syllable_boundary_fragment',
        };
      }
    }

    // Standard unhyphenated distinct words: keep space-separated
    return {
      hasTrailingHyphen: false,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: false,
      wordConfidenceLevel: 'LOW',
      safeSpaceSeparatedText,
      reason: 'unhyphenated_distinct_words',
    };
  }

  const stem = hyphenMatch[1];
  const rightFirstWordMatch = cleanRight.match(/^([\u0980-\u09FFa-zA-Z]+)/);
  if (!rightFirstWordMatch) {
    return {
      hasTrailingHyphen: true,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      safeSpaceSeparatedText,
      reason: 'trailing_hyphen_without_continuation_word',
    };
  }

  const rightWord = rightFirstWordMatch[1];
  // If stem ends with a bare hasanta before the hyphen (e.g., "সংস্কা্-"), do not guess
  if (/\u09CD$/.test(stem)) {
    return {
      hasTrailingHyphen: true,
      hasTrailingBareHasanta: true,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      proposedWordReconstruction: `${stem}${rightWord}`,
      safeSpaceSeparatedText,
      reason: 'trailing_hasanta_before_hyphen',
    };
  }

  const stemIsBengali = /[\u0980-\u09FF]/.test(stem);
  const rightIsBengali = /[\u0980-\u09FF]/.test(rightWord);

  if (stemIsBengali && rightIsBengali) {
    // 4a. Reduplicated Bengali word (দ্বিরুক্ত শব্দ, e.g. "ধীরে-ধীরে", "বারে-বারে", "কথায়-কথায়")
    const isExactReduplication = stem === rightWord;
    const isEchoReduplication =
      stem.length >= 3 &&
      rightWord.length === stem.length &&
      stem.slice(1) === rightWord.slice(1);

    // 4b. Intentional compound pair (দ্বন্দ্ব সমাস, e.g. "মা-বাবা", "সুখ-দুঃখ", "দেশ-বিদেশ")
    const isKnownCompound =
      stem.length >= 2 &&
      rightWord.length >= 2 &&
      isValidBengaliWord(stem) &&
      isValidBengaliWord(rightWord) &&
      BENGALI_COMPOUND_SECOND_WORDS.has(rightWord);

    if (isExactReduplication || isEchoReduplication || isKnownCompound) {
      const hyphenPreserved = normalizeMergedParagraphBoundary(left.replace(/\s*$/, ''), right, true);
      return {
        hasTrailingHyphen: true,
        hasTrailingBareHasanta: false,
        hasLeadingOrphanedMark: false,
        isKnownCompoundOrReduplicated: true,
        canJoinWord: false,
        isAmbiguousFragment: false,
        wordConfidenceLevel: 'HIGH',
        proposedWordReconstruction: `${stem}-${rightWord}`,
        joinedText: hyphenPreserved,
        safeSpaceSeparatedText: hyphenPreserved,
        reason: isKnownCompound ? 'intentional_compound_hyphen' : 'intentional_reduplicated_hyphen',
      };
    }

    // 4c. Validate candidate reconstructed Bengali word
    const joinedWord = stem + rightWord;
    if (isValidBengaliWord(joinedWord) && joinedWord.length <= 22) {
      const joinedFull = normalizeMergedParagraphBoundary(left.replace(/[-‐‑]\s*$/, ''), right, true);
      return {
        hasTrailingHyphen: true,
        hasTrailingBareHasanta: false,
        hasLeadingOrphanedMark: false,
        isKnownCompoundOrReduplicated: false,
        canJoinWord: true,
        isAmbiguousFragment: false,
        wordConfidenceLevel: 'HIGH',
        proposedWordReconstruction: joinedWord,
        joinedText: joinedFull,
        safeSpaceSeparatedText,
        reason: 'validated_bengali_split_word',
      };
    }

    // Failed Bengali word validation: preserve original text without guessing
    return {
      hasTrailingHyphen: true,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: false,
      isAmbiguousFragment: true,
      wordConfidenceLevel: 'LOW',
      proposedWordReconstruction: joinedWord,
      safeSpaceSeparatedText,
      reason: 'unverified_bengali_hyphen_fragment',
    };
  }

  // English hyphenated word split across line/page (e.g. "re-" + "construction")
  if (!stemIsBengali && !rightIsBengali && /^[a-z]/.test(rightWord)) {
    const joinedFull = normalizeMergedParagraphBoundary(left.replace(/[-‐‑]\s*$/, ''), right, true);
    return {
      hasTrailingHyphen: true,
      hasTrailingBareHasanta: false,
      hasLeadingOrphanedMark: false,
      isKnownCompoundOrReduplicated: false,
      canJoinWord: true,
      isAmbiguousFragment: false,
      wordConfidenceLevel: 'HIGH',
      proposedWordReconstruction: `${stem}${rightWord}`,
      joinedText: joinedFull,
      safeSpaceSeparatedText,
      reason: 'validated_english_split_word',
    };
  }

  return {
    hasTrailingHyphen: true,
    hasTrailingBareHasanta: false,
    hasLeadingOrphanedMark: false,
    isKnownCompoundOrReduplicated: false,
    canJoinWord: false,
    isAmbiguousFragment: true,
    wordConfidenceLevel: 'LOW',
    safeSpaceSeparatedText,
    reason: 'mixed_script_hyphen_boundary',
  };
}

/**
 * Losslessly joins two text segments (either hyphen-split, validated unhyphenated cross-page split,
 * or space-separated), preserving Bengali Unicode orthography and preventing accidental word concatenation.
 */
export function joinTwoTextSegmentsLosslessly(
  firstSegment: string,
  secondSegment: string,
  options: { allowUnhyphenatedCrossPageWordJoin?: boolean; layoutGeometryVerified?: boolean } = {}
): string {
  const analysis = analyzeBengaliBoundaryFragments(firstSegment, secondSegment, options);
  if (analysis.canJoinWord && analysis.joinedText) {
    return analysis.joinedText;
  }
  if (analysis.isKnownCompoundOrReduplicated && analysis.joinedText) {
    return analysis.joinedText;
  }
  return analysis.safeSpaceSeparatedText;
}

/**
 * Helper to create a concise boundary excerpt for diagnostics logging without bloating memory.
 */
function buildBoundaryExcerpt(prevBlock: string, nextBlock: string): string {
  const cleanPrev = prevBlock.replace(/\s+/g, ' ').trim();
  const cleanNext = nextBlock.replace(/\s+/g, ' ').trim();
  const prevTail = cleanPrev.length > 45 ? `...${cleanPrev.slice(-45)}` : cleanPrev;
  const nextHead = cleanNext.length > 45 ? `${cleanNext.slice(0, 45)}...` : cleanNext;
  return `${prevTail} <PAGE_BREAK> ${nextHead}`;
}

/**
 * Maps a numeric confidence score [0, 1] and decision state to an explicit
 * ReconstructionConfidenceLevel ('HIGH' | 'MEDIUM' | 'LOW').
 */
export function mapScoreToConfidenceLevel(score: number): ReconstructionConfidenceLevel {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.45) return 'MEDIUM';
  return 'LOW';
}

/**
 * Evaluates whether `prevBlock` and `nextBlock` represent a single continuous paragraph
 * interrupted by an artificial PDF page boundary or line break.
 *
 * Classifies the boundary as one of:
 * - 'SAME_PARAGRAPH'
 * - 'NEW_PARAGRAPH'
 * - 'NEW_HEADING'
 * - 'NEW_CHAPTER'
 * - 'STRUCTURED_CONTENT'
 * - 'UNCERTAIN'
 *
 * Also produces an explicit `boundaryDecision` ('SAFE_TO_MERGE' | 'SAFE_TO_SEPARATE' | 'UNCERTAIN'),
 * an explicit `confidenceLevel` ('HIGH' | 'MEDIUM' | 'LOW'), a deterministic `scoreBreakdown`,
 * and a structured `diagnostics` record.
 */
export function evaluateParagraphContinuation(
  prevBlock: string,
  nextBlock: string,
  context: {
    isPageBoundary?: boolean;
    nextPageIsChapterStart?: boolean;
    prevPageBlocks?: string[];
    nextPageBlocks?: string[];
    bookDetails?: BookDetails;
    prevPageLayoutBlocks?: PdfTextBlock[];
    nextPageLayoutBlocks?: PdfTextBlock[];
    pageWidth?: number;
  } = {}
): {
  classification: SmartSpacingBoundaryClassification;
  boundaryDecision: BoundaryDecisionType;
  shouldMerge: boolean;
  removeVisualPageGap: boolean;
  joinSplitWord: boolean;
  preservedOriginalFragment: boolean;
  confidence: ContinuationConfidence;
  confidenceLevel: ReconstructionConfidenceLevel;
  score: number;
  scoreBreakdown: Record<string, number>;
  signals: string[];
  nonMergeReason?: string;
  mergedText?: string;
  diagnostics: BoundaryReconstructionDiagnostic;
} {
  const originalBoundaryText = buildBoundaryExcerpt(prevBlock, nextBlock);
  const visualVerificationPerformed = Boolean(
    (context.prevPageLayoutBlocks && context.prevPageLayoutBlocks.length > 0) ||
      (context.nextPageLayoutBlocks && context.nextPageLayoutBlocks.length > 0)
  );

  if (context.nextPageIsChapterStart) {
    const scoreBreakdown = { next_page_is_chapter_start: 0 };
    return {
      classification: 'NEW_CHAPTER',
      boundaryDecision: 'SAFE_TO_SEPARATE',
      shouldMerge: false,
      removeVisualPageGap: false,
      joinSplitWord: false,
      preservedOriginalFragment: false,
      confidence: 'none',
      confidenceLevel: 'LOW',
      score: 0,
      scoreBreakdown,
      signals: ['next_page_is_chapter_start'],
      nonMergeReason: 'next_page_is_chapter_start',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
        confidenceLevel: 'LOW',
        confidenceScore: 0,
        scoreBreakdown,
        reason: 'next_page_is_chapter_start',
        evidenceUsed: ['next_page_is_chapter_start'],
        visualVerificationPerformed,
      },
    };
  }

  const surroundingBlocks = [
    ...(context.prevPageBlocks || []),
    ...(context.nextPageBlocks || []),
  ];

  // Check nextBlock first so NEW_CHAPTER / NEW_HEADING / STRUCTURED_CONTENT at the top of the next page is classified accurately
  const nextCheck = isStructuralNonMergeBlock(nextBlock, surroundingBlocks, {
    bookDetails: context.bookDetails,
    layoutBlocks: context.nextPageLayoutBlocks,
  });
  if (nextCheck.isNonMerge) {
    const isNewChapter = nextCheck.structuralKind === 'NEW_CHAPTER';
    const signalName = `next_${nextCheck.reason}`;
    const scoreBreakdown = { [signalName]: 0 };
    return {
      classification: nextCheck.structuralKind || 'STRUCTURED_CONTENT',
      boundaryDecision: 'SAFE_TO_SEPARATE',
      shouldMerge: false,
      removeVisualPageGap: !isNewChapter,
      joinSplitWord: false,
      preservedOriginalFragment: false,
      confidence: 'none',
      confidenceLevel: 'LOW',
      score: 0,
      scoreBreakdown,
      signals: [signalName],
      nonMergeReason: signalName,
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
        confidenceLevel: 'LOW',
        confidenceScore: 0,
        scoreBreakdown,
        reason: signalName,
        evidenceUsed: [signalName],
        visualVerificationPerformed,
      },
    };
  }

  const prevCheck = isStructuralNonMergeBlock(prevBlock, surroundingBlocks, {
    bookDetails: context.bookDetails,
    layoutBlocks: context.prevPageLayoutBlocks,
  });
  if (prevCheck.isNonMerge) {
    const signalName = `prev_${prevCheck.reason}`;
    const scoreBreakdown = { [signalName]: 0 };
    return {
      classification: 'STRUCTURED_CONTENT',
      boundaryDecision: 'SAFE_TO_SEPARATE',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: false,
      confidence: 'none',
      confidenceLevel: 'LOW',
      score: 0,
      scoreBreakdown,
      signals: [signalName],
      nonMergeReason: signalName,
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
        confidenceLevel: 'LOW',
        confidenceScore: 0,
        scoreBreakdown,
        reason: signalName,
        evidenceUsed: [signalName],
        visualVerificationPerformed,
      },
    };
  }

  // Check if either block has ambiguous prose-poetry characteristics: preserve conservatively!
  const prevProsePoetry = isUnmarkedProsePoetryBlock(prevBlock, surroundingBlocks, {
    bookDetails: context.bookDetails,
    layoutBlocks: context.prevPageLayoutBlocks,
  });
  const nextProsePoetry = isUnmarkedProsePoetryBlock(nextBlock, surroundingBlocks, {
    bookDetails: context.bookDetails,
    layoutBlocks: context.nextPageLayoutBlocks,
  });

  if (prevProsePoetry.isAmbiguous && nextProsePoetry.isAmbiguous) {
    const signals = [
      'ambiguous_prose_poetry_boundary',
      ...prevProsePoetry.signals,
      ...nextProsePoetry.signals,
    ];
    const scoreBreakdown = { ambiguous_prose_poetry_boundary: 0.35 };
    return {
      classification: 'UNCERTAIN',
      boundaryDecision: 'UNCERTAIN',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: true,
      confidence: 'low',
      confidenceLevel: 'LOW',
      score: 0.35,
      scoreBreakdown,
      signals,
      nonMergeReason: 'ambiguous_prose_poetry_preserved',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'FLAGGED_UNCERTAIN_PRESERVED',
        confidenceLevel: 'LOW',
        confidenceScore: 0.35,
        scoreBreakdown,
        reason: 'ambiguous_prose_poetry_preserved',
        evidenceUsed: signals,
        visualVerificationPerformed,
      },
    };
  }

  // Strip inline formatting tags for linguistic analysis while keeping raw text for merging
  const cleanPrev = prevBlock.replace(/<[^>]+>/g, '').trim();
  const cleanNext = nextBlock.replace(/<[^>]+>/g, '').trim();

  if (!cleanPrev || !cleanNext) {
    const scoreBreakdown = { empty_text: 0 };
    return {
      classification: 'UNCERTAIN',
      boundaryDecision: 'UNCERTAIN',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: true,
      confidence: 'none',
      confidenceLevel: 'LOW',
      score: 0,
      scoreBreakdown,
      signals: [],
      nonMergeReason: 'empty_text',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'FLAGGED_UNCERTAIN_PRESERVED',
        confidenceLevel: 'LOW',
        confidenceScore: 0,
        scoreBreakdown,
        reason: 'empty_text',
        evidenceUsed: [],
        visualVerificationPerformed,
      },
    };
  }

  // Distinguish genuine sentence-ending punctuation from ellipses (... / …) and abbreviations (ড., মি., Dr., etc.)
  const prevEndsWithEllipsis = /(?:\.{2,}|…)\s*['"”’)\]]*\s*$/.test(cleanPrev);
  const prevEndsWithAbbreviation =
    /(?:^|\s)(?:ড|মো|মি|লি|প্রা|খ্রি|পূ|অধ্যা|নং|ডা|ইঞ্জি|প্রো|Dr|Mr|Mrs|Ms|Prof|Fig|No|Vol|pp|etc|vs|Jr|Sr)\.\s*['"”’)\]]*\s*$/i.test(
      cleanPrev
    );
  const prevEndsWithTerminalPunct =
    !prevEndsWithEllipsis &&
    !prevEndsWithAbbreviation &&
    /[।॥.?!]\s*['"”’)\]]*\s*$/.test(cleanPrev);

  // Evaluate layout geometry if PDF layoutBlocks are provided, filtering out running headers, footers, page numbers, and watermarks
  const filterBodyLayoutBlocks = (
    blocks: PdfTextBlock[] | undefined,
    edgePos: 'top' | 'bottom'
  ): PdfTextBlock[] => {
    if (!blocks || blocks.length === 0) return [];
    return blocks.filter((b, idx) => {
      const t = (b.text || '').trim();
      if (!t) return false;
      if (idx === 0 && isPageBoundaryArtifactLine(t, 'top', context.bookDetails)) return false;
      if (idx === blocks.length - 1 && isPageBoundaryArtifactLine(t, 'bottom', context.bookDetails))
        return false;
      if (isPageBoundaryArtifactLine(t, edgePos, context.bookDetails)) return false;
      return true;
    });
  };

  const cleanPrevLayoutBlocks = filterBodyLayoutBlocks(context.prevPageLayoutBlocks, 'bottom');
  const cleanNextLayoutBlocks = filterBodyLayoutBlocks(context.nextPageLayoutBlocks, 'top');

  const allGeoBlocks = [...cleanPrevLayoutBlocks, ...cleanNextLayoutBlocks];
  const maxObservedRightEdge = allGeoBlocks.reduce(
    (maxR, b) => Math.max(maxR, (b.x || 0) + (b.width || 0)),
    0
  );
  const pageWidth = Math.max(
    context.pageWidth || 600,
    maxObservedRightEdge > 600 ? Math.round(maxObservedRightEdge * 1.06) : 600
  );

  let prevLineReachesRightMargin = false;
  let prevLineShortParagraphEnd = false;
  let nextLineGeometryIndented = false;
  let nextLineGeometryFlushLeft = false;

  if (cleanPrevLayoutBlocks.length > 0) {
    const lastGeo = cleanPrevLayoutBlocks[cleanPrevLayoutBlocks.length - 1];
    const rightEdge = lastGeo.x + lastGeo.width;
    if (rightEdge >= pageWidth * 0.78) {
      prevLineReachesRightMargin = true;
    } else if (rightEdge <= pageWidth * 0.60 && prevEndsWithTerminalPunct) {
      prevLineShortParagraphEnd = true;
    }
  }

  if (cleanNextLayoutBlocks.length >= 2) {
    const firstGeo = cleanNextLayoutBlocks[0];
    const otherLeftEdges = cleanNextLayoutBlocks.slice(1).map((b) => b.x);
    const minLeftX = Math.min(...otherLeftEdges);
    const indentDelta = firstGeo.x - minLeftX;
    // A genuine first-line paragraph indent is 14..90px (larger deltas are centered headers/titles)
    if (indentDelta >= 14 && indentDelta <= 90 && prevEndsWithTerminalPunct) {
      nextLineGeometryIndented = true;
    } else if (indentDelta <= 6) {
      nextLineGeometryFlushLeft = true;
    }
  }

  const nextHasExplicitIndent =
    /^(?: {2,}|\t)/.test(nextBlock) ||
    (prevEndsWithTerminalPunct &&
      /class=["'][^"']*\bindent-(?:1|2|line)\b/i.test(nextBlock)) ||
    nextLineGeometryIndented;

  // Analyze Bengali / English boundary tokens for split words (both hyphenated and unhyphenated), bare hasanta (্), or orphaned marks
  const allowUnhyphenatedWordJoin =
    Boolean(context.isPageBoundary) && !prevEndsWithTerminalPunct && !nextHasExplicitIndent;
  const fragmentAnalysis = analyzeBengaliBoundaryFragments(prevBlock, nextBlock, {
    allowUnhyphenatedCrossPageWordJoin: allowUnhyphenatedWordJoin,
    layoutGeometryVerified: prevLineReachesRightMargin && nextLineGeometryFlushLeft,
  });

  // Guard: If the boundary has an ambiguous OCR word fragment (trailing bare hasanta ্, orphaned vowel sign,
  // unverified hyphen fragment, or medium-confidence unverified unhyphenated split), classify as UNCERTAIN
  // and preserve the original text rather than guessing!
  if (fragmentAnalysis.isAmbiguousFragment) {
    const ambigScore = fragmentAnalysis.wordConfidenceLevel === 'MEDIUM' ? 0.52 : 0.25;
    const ambigLevel: ReconstructionConfidenceLevel =
      fragmentAnalysis.wordConfidenceLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW';
    const scoreBreakdown = { [fragmentAnalysis.reason]: ambigScore };
    const proposedCandidate = fragmentAnalysis.proposedWordReconstruction
      ? `${prevBlock.trimEnd()} + ${nextBlock.trimStart()} -> ${fragmentAnalysis.proposedWordReconstruction}`
      : fragmentAnalysis.safeSpaceSeparatedText;
    return {
      classification: 'UNCERTAIN',
      boundaryDecision: 'UNCERTAIN',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: true,
      confidence: ambigLevel === 'MEDIUM' ? 'medium' : 'low',
      confidenceLevel: ambigLevel,
      score: ambigScore,
      scoreBreakdown,
      signals: [fragmentAnalysis.reason],
      nonMergeReason: 'uncertain_split_word_fragment',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: proposedCandidate,
        finalDecision: 'FLAGGED_UNCERTAIN_PRESERVED',
        confidenceLevel: ambigLevel,
        confidenceScore: ambigScore,
        scoreBreakdown,
        reason: fragmentAnalysis.reason,
        evidenceUsed: [fragmentAnalysis.reason],
        visualVerificationPerformed,
      },
    };
  }

  // Guard: If nextBlock starts with explicit first-line paragraph indentation
  // AND prevBlock ends with terminal punctuation, it is definitely a new paragraph!
  if (nextHasExplicitIndent && prevEndsWithTerminalPunct) {
    const scoreBreakdown = {
      prev_terminal_punctuation: 0,
      next_explicit_paragraph_indent: 0.05,
    };
    return {
      classification: 'NEW_PARAGRAPH',
      boundaryDecision: 'SAFE_TO_SEPARATE',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: false,
      confidence: 'low',
      confidenceLevel: 'LOW',
      score: 0.05,
      scoreBreakdown,
      signals: ['prev_terminal_punctuation', 'next_explicit_paragraph_indent'],
      nonMergeReason: 'indented_new_paragraph_after_sentence_end',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
        confidenceLevel: 'LOW',
        confidenceScore: 0.05,
        scoreBreakdown,
        reason: 'indented_new_paragraph_after_sentence_end',
        evidenceUsed: ['prev_terminal_punctuation', 'next_explicit_paragraph_indent'],
        visualVerificationPerformed,
      },
    };
  }

  // Guard: Dialogue speaker turn at start of nextBlock (e.g., "নন্দিনী।", "রাজা:", "**রাহুল:**")
  // or a new dialogue quote turn after a COMPLETED sentence ending with a closing quote
  if (
    /^(?:\*\*[^*]{1,25}\*\*|[\u0980-\u09FF]{2,15})\s*[।:—–-]\s+/.test(cleanNext) ||
    (prevEndsWithTerminalPunct && /['"”’]\s*$/.test(cleanPrev) && /^['"“‘]/.test(cleanNext))
  ) {
    const scoreBreakdown = { dialogue_turn_boundary: 0.1 };
    return {
      classification: 'NEW_PARAGRAPH',
      boundaryDecision: 'SAFE_TO_SEPARATE',
      shouldMerge: false,
      removeVisualPageGap: true,
      joinSplitWord: false,
      preservedOriginalFragment: false,
      confidence: 'low',
      confidenceLevel: 'LOW',
      score: 0.1,
      scoreBreakdown,
      signals: ['dialogue_turn_boundary'],
      nonMergeReason: 'dialogue_turn_boundary',
      diagnostics: {
        originalBoundaryText,
        proposedReconstruction: originalBoundaryText,
        finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
        confidenceLevel: 'LOW',
        confidenceScore: 0.1,
        scoreBreakdown,
        reason: 'dialogue_turn_boundary',
        evidenceUsed: ['dialogue_turn_boundary'],
        visualVerificationPerformed,
      },
    };
  }

  let score = 0;
  const scoreBreakdown: Record<string, number> = {};
  const signals: string[] = [];

  // Signal 1: Validated hyphenated word, intentional compound, or HIGH-confidence unhyphenated split word
  const endsWithHyphen = fragmentAnalysis.hasTrailingHyphen;
  const isUnhyphenatedSplitWord = Boolean(fragmentAnalysis.isUnhyphenatedSplitWord);

  if (endsWithHyphen) {
    const sig = fragmentAnalysis.canJoinWord
      ? 'validated_trailing_hyphenated_word'
      : 'intentional_compound_hyphenated_word';
    score += 0.55;
    scoreBreakdown[sig] = 0.55;
    signals.push(sig);
  } else if (isUnhyphenatedSplitWord && fragmentAnalysis.canJoinWord) {
    score += 0.52;
    scoreBreakdown[fragmentAnalysis.reason] = 0.52;
    signals.push(fragmentAnalysis.reason);
  } else if (fragmentAnalysis.reason === 'standalone_words_kept_separate') {
    signals.push('standalone_words_kept_separate');
  }

  // Signal 2: Incomplete sentence at the end of prevBlock (no terminal danda/period/question/exclamation)
  if (!prevEndsWithTerminalPunct && !endsWithHyphen) {
    // Check if it ends with colon introducing a new block/paragraph
    if (/[:]\s*$/.test(cleanPrev)) {
      const colonBreakdown = { ends_with_colon: 0.2 };
      return {
        classification: 'NEW_PARAGRAPH',
        boundaryDecision: 'SAFE_TO_SEPARATE',
        shouldMerge: false,
        removeVisualPageGap: true,
        joinSplitWord: false,
        preservedOriginalFragment: false,
        confidence: 'low',
        confidenceLevel: 'LOW',
        score: 0.2,
        scoreBreakdown: colonBreakdown,
        signals: ['ends_with_colon'],
        nonMergeReason: 'ends_with_colon_introducer',
        diagnostics: {
          originalBoundaryText,
          proposedReconstruction: originalBoundaryText,
          finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
          confidenceLevel: 'LOW',
          confidenceScore: 0.2,
          scoreBreakdown: colonBreakdown,
          reason: 'ends_with_colon_introducer',
          evidenceUsed: ['ends_with_colon'],
          visualVerificationPerformed,
        },
      };
    }

    score += 0.45;
    scoreBreakdown.incomplete_sentence_ending = 0.45;
    signals.push('incomplete_sentence_ending');

    // Sub-signal 2a: Ends with comma, semicolon, dash, ellipsis, or abbreviation period
    if (/[,;—–]\s*['"”’)\]]*\s*$/.test(cleanPrev) || prevEndsWithEllipsis || prevEndsWithAbbreviation) {
      score += 0.2;
      scoreBreakdown.trailing_comma_or_semicolon = 0.2;
      signals.push('trailing_comma_or_semicolon');
    }

    // Sub-signal 2b: Ends with a conjunction, preposition, or postposition
    const lastWordMatch = cleanPrev.match(/([\u0980-\u09FFa-zA-Z]+)\s*[,;—–]?\s*['"”’)\]]*\s*$/);
    if (lastWordMatch) {
      const lastWord = lastWordMatch[1].toLowerCase();
      if (INCOMPLETE_ENDING_WORDS.has(lastWord)) {
        const sig = `trailing_connector_word:${lastWord}`;
        score += 0.22;
        scoreBreakdown[sig] = 0.22;
        signals.push(sig);
      }
    }

    // Sub-signal 2c: Continued quoted fragment where both pages wrapped parts of the same incomplete sentence in quotes
    if (/[^।॥.?!\s]\s*['"”’]\s*$/.test(cleanPrev) && /^['"“‘]/.test(cleanNext)) {
      score += 0.22;
      scoreBreakdown.continued_quoted_fragment_across_page = 0.22;
      signals.push('continued_quoted_fragment_across_page');
    }
  }

  // Signal 3: Continuation characteristics at the start of nextBlock
  const cleanNextWithoutQuote = cleanNext.replace(/^['"“‘]\s*/, '');
  const startsWithLowercaseLatin = /^[a-z]/.test(cleanNextWithoutQuote);
  const startsWithBengaliWord = /^[\u0980-\u09FF]/.test(cleanNextWithoutQuote);

  if (startsWithLowercaseLatin) {
    score += 0.4;
    scoreBreakdown.next_starts_lowercase_latin = 0.4;
    signals.push('next_starts_lowercase_latin');
  } else if (startsWithBengaliWord && !nextHasExplicitIndent && !prevEndsWithTerminalPunct) {
    score += 0.28;
    scoreBreakdown.next_unindented_bengali_continuation = 0.28;
    signals.push('next_unindented_bengali_continuation');

    // Sub-signal 3a: Next page starts with a Bengali continuation verb, compound verb part, or clause predicate
    // (e.g. "উন্মোচন করবে", "প্রকাশ করে", "নিয়ে আসবে", "হয়েছে", "করবে")
    const nextFirstWordsMatch = cleanNextWithoutQuote.match(
      /^([\u0980-\u09FF]+)(?:\s+([\u0980-\u09FF]+))?/
    );
    if (nextFirstWordsMatch) {
      const w1 = nextFirstWordsMatch[1].replace(/[।॥,;:!?'"”’)\]-]/g, '');
      const w2 = (nextFirstWordsMatch[2] || '').replace(/[।॥,;:!?'"”’)\]-]/g, '');
      const continuationPredicates = new Set([
        'করবে', 'করেন', 'করে', 'করেছে', 'করেছেন', 'করল', 'করলো', 'করা', 'করতে', 'করিয়া',
        'হবে', 'হয়', 'হয়', 'হয়েছে', 'হয়েছে', 'হলো', 'হল', 'হতে', 'হওয়া', 'হওয়া',
        'দেয়', 'দেয়', 'দিল', 'দিলো', 'দেওয়া', 'দেওয়া', 'নেয়', 'নেয়', 'নিল', 'নিয়ে', 'নিয়ে',
        'যায়', 'যায়', 'গেল', 'গেছে', 'গিয়ে', 'গিয়ে', 'আসে', 'আসবে', 'এল', 'এলো', 'এসেছে',
        'থাকে', 'থাকবে', 'থাকল', 'বলে', 'বলেন', 'বলল', 'রাখে', 'রাখবে', 'পারে', 'পারবে',
        'পায়', 'পায়', 'পেল', 'উন্মোচন', 'প্রকাশ', 'সম্পন্ন', 'প্রতিষ্ঠা', 'অর্জন', 'নির্মাণ',
      ]);
      if (continuationPredicates.has(w1) || continuationPredicates.has(w2)) {
        score += 0.16;
        scoreBreakdown.next_starts_continuation_predicate = 0.16;
        signals.push('next_starts_continuation_predicate');
      }
    }
  }

  // Signal 4: Unbalanced opening quote or parenthesis in prevBlock closed in nextBlock
  const openDoubleQuotesPrev = (cleanPrev.match(/[“]/g) || []).length;
  const closeDoubleQuotesPrev = (cleanPrev.match(/[”]/g) || []).length;
  const openDoubleQuotesNext = (cleanNext.match(/[“]/g) || []).length;
  const closeDoubleQuotesNext = (cleanNext.match(/[”]/g) || []).length;
  const hasUnclosedQuoteSpanningBoundary =
    openDoubleQuotesPrev > closeDoubleQuotesPrev && closeDoubleQuotesNext > openDoubleQuotesNext;

  if (hasUnclosedQuoteSpanningBoundary) {
    score += 0.3;
    scoreBreakdown.unclosed_quotation_spanning_boundary = 0.3;
    signals.push('unclosed_quotation_spanning_boundary');
  }

  const openParensPrev = (cleanPrev.match(/\(/g) || []).length - (cleanPrev.match(/\)/g) || []).length;
  const closeParensNext = (cleanNext.match(/\)/g) || []).length - (cleanNext.match(/\(/g) || []).length;
  const hasUnclosedParenSpanningBoundary = openParensPrev > 0 && closeParensNext > 0;
  if (hasUnclosedParenSpanningBoundary) {
    score += 0.3;
    scoreBreakdown.unclosed_parenthesis_spanning_boundary = 0.3;
    signals.push('unclosed_parenthesis_spanning_boundary');
  }

  // Signal 4b (Case 8): Page ends with sentence punctuation (। / . / ? / !), BUT the paragraph
  // genuinely continues across the page boundary because:
  // (a) an unclosed multi-sentence quotation or parenthesis spans across the boundary, OR
  // (b) layout geometry confirms the last line of Page N reached the right margin (>= 78% width)
  //     and Page N+1 starts flush-left unindented with a discourse continuation marker or pronoun.
  const startsWithDiscourseContinuation =
    /^(?:ফলে|এছাড়া|এছাড়া|তাছাড়া|তাছাড়া|কারণ|কিন্তু|তবে|সুতরাং|অতএব|অন্যদিকে|পাশাপাশি|এমনকি|অর্থাৎ|বিশেষত|মূলত|বস্তুত|প্রকৃতপক্ষে|সেজন্য|তাই|যদিও|তথাপি|এই|সেই|এর|তাঁর|তার|এতে|এখানে)(?=\s|[।॥,;:!?'"”’)\]-]|$)/.test(
      cleanNextWithoutQuote
    );
  const continuesParagraphAfterTerminalPunct =
    prevEndsWithTerminalPunct &&
    !nextHasExplicitIndent &&
    !prevLineShortParagraphEnd &&
    (hasUnclosedQuoteSpanningBoundary ||
      hasUnclosedParenSpanningBoundary ||
      (prevLineReachesRightMargin && nextLineGeometryFlushLeft && startsWithDiscourseContinuation));

  if (continuesParagraphAfterTerminalPunct) {
    score += 0.58;
    scoreBreakdown.paragraph_continues_after_terminal_punctuation = 0.58;
    signals.push('paragraph_continues_after_terminal_punctuation');
  }

  // Signal 5: Page boundary & optional layout geometry signals
  if (context.isPageBoundary && (!prevEndsWithTerminalPunct || continuesParagraphAfterTerminalPunct)) {
    score += 0.12;
    scoreBreakdown.cross_page_boundary_prose = 0.12;
    signals.push('cross_page_boundary_prose');
  }

  if (prevLineReachesRightMargin) {
    score += 0.14;
    scoreBreakdown.geometry_prev_line_reaches_right_margin = 0.14;
    signals.push('geometry_prev_line_reaches_right_margin');
  } else if (prevLineShortParagraphEnd) {
    score -= 0.25;
    scoreBreakdown.geometry_prev_line_short_paragraph_end = -0.25;
    signals.push('geometry_prev_line_short_paragraph_end');
  }

  if (nextLineGeometryIndented) {
    score -= 0.30;
    scoreBreakdown.geometry_next_line_first_line_indented = -0.30;
    signals.push('geometry_next_line_first_line_indented');
  } else if (nextLineGeometryFlushLeft && (!prevEndsWithTerminalPunct || continuesParagraphAfterTerminalPunct)) {
    score += 0.10;
    scoreBreakdown.geometry_next_line_flush_left = 0.10;
    signals.push('geometry_next_line_flush_left');
  }

  // Clamp score to [0, 1]
  const finalScore = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const confidenceLevel = mapScoreToConfidenceLevel(finalScore);

  let confidence: ContinuationConfidence = 'low';
  let shouldMerge = false;
  let classification: SmartSpacingBoundaryClassification = 'NEW_PARAGRAPH';
  let boundaryDecision: BoundaryDecisionType = 'SAFE_TO_SEPARATE';

  if (finalScore >= 0.75) {
    confidence = 'high';
    shouldMerge = true;
    classification = 'SAME_PARAGRAPH';
    boundaryDecision = 'SAFE_TO_MERGE';
  } else if (
    finalScore >= 0.55 &&
    signals.length >= 2 &&
    (!prevEndsWithTerminalPunct || continuesParagraphAfterTerminalPunct)
  ) {
    confidence = 'medium';
    shouldMerge = true;
    classification = 'SAME_PARAGRAPH';
    boundaryDecision = 'SAFE_TO_MERGE';
  } else if (prevEndsWithTerminalPunct) {
    confidence = 'low';
    shouldMerge = false;
    classification = 'NEW_PARAGRAPH';
    boundaryDecision = 'SAFE_TO_SEPARATE';
  } else {
    confidence = 'low';
    shouldMerge = false;
    classification = 'UNCERTAIN';
    boundaryDecision = 'UNCERTAIN';
  }

  // Word joining requires HIGH confidence (confidenceLevel === 'HIGH') and fragmentAnalysis.canJoinWord
  const joinSplitWord = shouldMerge && confidenceLevel === 'HIGH' && fragmentAnalysis.canJoinWord;
  const mergedText = shouldMerge
    ? joinSplitWord && fragmentAnalysis.joinedText
      ? fragmentAnalysis.joinedText
      : fragmentAnalysis.isKnownCompoundOrReduplicated && fragmentAnalysis.joinedText
      ? fragmentAnalysis.joinedText
      : fragmentAnalysis.safeSpaceSeparatedText
    : undefined;

  const finalDecision: BoundaryReconstructionDiagnostic['finalDecision'] = shouldMerge
    ? joinSplitWord
      ? 'RECONSTRUCTED_WORD_AND_MERGED'
      : 'MERGED_PARAGRAPH_ONLY'
    : boundaryDecision === 'UNCERTAIN'
    ? 'FLAGGED_UNCERTAIN_PRESERVED'
    : 'PRESERVED_SEPARATE_BLOCKS';

  const nonMergeReason = shouldMerge
    ? undefined
    : prevEndsWithTerminalPunct
    ? 'prev_sentence_complete'
    : 'uncertain_or_insufficient_confidence';

  return {
    classification,
    boundaryDecision,
    shouldMerge,
    removeVisualPageGap: true,
    joinSplitWord,
    preservedOriginalFragment: !joinSplitWord,
    confidence,
    confidenceLevel,
    score: finalScore,
    scoreBreakdown,
    signals,
    nonMergeReason,
    mergedText,
    diagnostics: {
      originalBoundaryText,
      proposedReconstruction: mergedText
        ? buildBoundaryExcerpt(mergedText, '')
        : fragmentAnalysis.proposedWordReconstruction || originalBoundaryText,
      finalDecision,
      confidenceLevel,
      confidenceScore: finalScore,
      scoreBreakdown,
      reason: shouldMerge
        ? joinSplitWord
          ? fragmentAnalysis.reason
          : 'continuing_paragraph_across_page'
        : nonMergeReason || 'separate_blocks',
      evidenceUsed: signals,
      visualVerificationPerformed,
    },
  };
}

/**
 * Convenience helper for classifying cross-page continuity between the final block of
 * Page N and the first block of Page N+1.
 */
export function classifyCrossPageContinuity(
  prevPageLastBlock: string,
  nextPageFirstBlock: string,
  nextPageIsChapterStart: boolean = false,
  surroundingContext?: {
    prevPageBlocks?: string[];
    nextPageBlocks?: string[];
    bookDetails?: BookDetails;
    prevPageLayoutBlocks?: PdfTextBlock[];
    nextPageLayoutBlocks?: PdfTextBlock[];
    pageWidth?: number;
  }
) {
  return evaluateParagraphContinuation(prevPageLastBlock, nextPageFirstBlock, {
    isPageBoundary: true,
    nextPageIsChapterStart,
    prevPageBlocks: surroundingContext?.prevPageBlocks,
    nextPageBlocks: surroundingContext?.nextPageBlocks,
    bookDetails: surroundingContext?.bookDetails,
    prevPageLayoutBlocks: surroundingContext?.prevPageLayoutBlocks,
    nextPageLayoutBlocks: surroundingContext?.nextPageLayoutBlocks,
    pageWidth: surroundingContext?.pageWidth,
  });
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
  const visit = (items: EpubTocItem[], isTopLevel: boolean) => {
    for (const item of items || []) {
      const isMajorStructuralNode =
        isTopLevel ||
        item.level === 1 ||
        item.semanticType === 'chapter' ||
        item.semanticType === 'part' ||
        item.semanticType === 'frontmatter' ||
        item.semanticType === 'backmatter';
      if (isMajorStructuralNode && typeof item.targetPageNumber === 'number' && item.targetPageNumber > 0) {
        set.add(item.targetPageNumber);
      }
      if (item.children && item.children.length > 0) {
        visit(item.children, false);
      }
    }
  };
  visit(nodes, true);
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
  tocPageNumbers: Set<number>,
  prevPage?: PageItem
): boolean {
  // First content page always starts a spine section
  if (pageIndexInContent === 0) return true;

  // TOC pages are handled separately (only trust tocPageNumbers or verified TOC structure)
  if (tocPageNumbers.has(page.pageNumber)) return true;

  if (!page.markdown || !page.markdown.trim()) return false;

  // Inspect the first non-empty line of the page (and the first non-figure text line if the page opens with a chapter illustration)
  const lines = page.markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  let firstContentLine = lines[0];
  if (firstContentLine.includes('[IMAGE_FIGURE:') || /^!\[.*?\]\(.*?\)$/.test(firstContentLine)) {
    let nextIdx = 1;
    if (
      nextIdx < lines.length &&
      /^(?:\*|_)?(?:চিত্র|ছবি|ক্যাপশন|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)(?=\s|$|[:।.\-–—]|[০-৯0-9])/i.test(lines[nextIdx])
    ) {
      nextIdx++;
    }
    if (nextIdx < lines.length) {
      firstContentLine = lines[nextIdx];
    }
  }

  // Explicit Markdown Heading (# , ## , ### , #### ) or HTML <h1>..<h4> at the start of the page
  if (/^#{1,4}\s+\S/.test(firstContentLine) || /^<h[1-4][\s>]/i.test(firstContentLine)) {
    return true;
  }

  // Unwrap bold/center/p to check for Part / Chapter / Front-Matter keywords at top of page
  const unwrapped = firstContentLine
    .replace(/^<center>(.*?)<\/center>$/i, '$1')
    .replace(/^\[center\](.*?)\[\/center\]$/i, '$1')
    .replace(/^->\s*(.*?)\s*<-$/, '$1')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^<strong>(.*?)<\/strong>$/i, '$1')
    .replace(/^<p(?:\s[^>]*)?>(.*?)<\/p>$/i, '$1')
    .trim();

  if (unwrapped.length <= 100) {
    const isMajorChapterKeyword =
      /^(?:Part|Volume|Book|Act|Chapter|Chapitre|Kapitel|Preface|Foreword|Introduction|Prologue|Dedication|Epilogue|Conclusion|Appendix|Bibliography|Index)\b/i.test(
        unwrapped
      ) ||
      /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়|পরিচ্ছেদ|দৃশ্য)|(?:পর্ব|খণ্ড|ভাগ|অঙ্ক|অধ্যায়|অধ্যায়|পরিচ্ছেদ|দৃশ্য)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ)|ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উৎসর্গ|লেখকের কথা|প্রকাশকের কথা|কৃতজ্ঞতা স্বীকার|উপসংহার|পরিশিষ্ট|নির্ঘণ্ট|গ্রন্থপঞ্জি|তথ্যসূত্র)(?=\s|$|[।:.,\-–—)\]])/i.test(
        unwrapped
      );

    if (isMajorChapterKeyword) {
      return true;
    }
  }

  // If this page is targeted by TOC or has a changed chapterTitle, verify that it is NOT
  // continuing an unfinished mid-sentence paragraph from the bottom of prevPage!
  if (
    tocTargetPages.has(page.pageNumber) ||
    (page.chapterTitle &&
      page.chapterTitle.trim().length > 0 &&
      prevPage?.chapterTitle &&
      page.chapterTitle.trim() !== prevPage.chapterTitle.trim())
  ) {
    if (prevPage && prevPage.markdown && prevPage.markdown.trim()) {
      const prevBlocks = splitMarkdownIntoLogicalBlocks(prevPage.markdown);
      const nextBlocks = splitMarkdownIntoLogicalBlocks(page.markdown);
      const lastPrevBlock = prevBlocks[prevBlocks.length - 1] || '';
      const firstNextBlock = nextBlocks[0] || '';
      if (lastPrevBlock && firstNextBlock) {
        const cleanPrevLast = lastPrevBlock.replace(/<[^>]+>/g, '').trim();
        const prevEndsIncomplete =
          cleanPrevLast.length > 0 && !/[।॥.?!:]\s*['"”’)\]]*$/.test(cleanPrevLast);
        if (prevEndsIncomplete) {
          const contEval = evaluateParagraphContinuation(lastPrevBlock, firstNextBlock, {
            isPageBoundary: true,
            nextPageIsChapterStart: false,
            prevPageBlocks: prevBlocks,
            nextPageBlocks: nextBlocks,
          });
          if (contEval.shouldMerge) {
            return false;
          }
        }
      }
    }
    return true;
  }

  return false;
}

/**
 * Splits a page's Markdown into logical paragraph/structural blocks while preserving
 * multi-line structures (lists, poetry/stanzas, blockquotes, tables, alignment blocks).
 * Never merges intentional single-newline line breaks within a page.
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

    // Figures and markdown images: keep genuine caption lines attached, and discard standalone generic "চিত্র" placeholders
    if (trimmed.includes('[IMAGE_FIGURE:') || /^!\[.*?\]\(.*?\)$/.test(trimmed)) {
      flushCurrent();
      let figureBlock = rawLine.trim();

      let lookaheadIdx = i + 1;
      if (lookaheadIdx < lines.length && !lines[lookaheadIdx].trim() && lookaheadIdx + 1 < lines.length) {
        lookaheadIdx++;
      }
      if (lookaheadIdx < lines.length) {
        const nextTrimmed = lines[lookaheadIdx].trim();
        const unwrappedNext = nextTrimmed
          .replace(/^(?:\*+|_+|\s+|\[+|\(+|["'“”‘’]+)+|(?:\*+|_+|\s+|\]+|\)+|["'“”‘’]+)+$/g, '')
          .trim();

        const isStandaloneGenericPlaceholder =
          Boolean(unwrappedNext) &&
          /^(?:চিত্র|ছবি|ক্যাপশন|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|অলঙ্করণ|লোগো|আইকন|প্রতিকৃতি|figure|image|illustration|diagram|photo|caption)(?:\s*[:।.\-–—])?$/i.test(
            unwrappedNext
          );
        const isGenuineFigureCaption =
          !isStandaloneGenericPlaceholder &&
          /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*(?:[০-৯0-9]+\s*[:.—–-]?\s*\S+|[:.—–-]\s*\S+)/i.test(
            nextTrimmed
          );

        if (isStandaloneGenericPlaceholder) {
          i = lookaheadIdx; // consume and discard unwanted generic "চিত্র" placeholder line
        } else if (isGenuineFigureCaption) {
          figureBlock = `${figureBlock}\n${nextTrimmed}`;
          i = lookaheadIdx; // keep genuine caption attached to figure block
        }
      }

      blocks.push(figureBlock);
      continue;
    }

    // Headings, Section dividers, and standalone HTML <p...>...<\/p> or <div...>...<\/div> paragraphs are standalone blocks
    if (
      /^#{1,6}\s/.test(trimmed) ||
      /^<h[1-6][\s>]/i.test(trimmed) ||
      /^<(?:p|div)(?:\s[^>]*)?>[\s\S]*<\/(?:p|div)>$/i.test(trimmed) ||
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

    // Preserve intentional single-newline line breaks (e.g. poetry couplets, stanzas, dialogue lines)
    // by keeping consecutive non-empty lines grouped as a multi-line block without flattening `\n` into spaces
    if (currentLines.length > 0) {
      const prevLine = currentLines[currentLines.length - 1];
      const prevIsListOrTableOrQuote =
        /^[-*•+]\s+/.test(prevLine.trim()) ||
        /^[০-৯0-9]+[.)]\s+/.test(prevLine.trim()) ||
        prevLine.trim().startsWith('> ') ||
        (prevLine.trim().startsWith('|') && prevLine.trim().endsWith('|'));

      if (prevIsListOrTableOrQuote) {
        flushCurrent();
      }
      currentLines.push(rawLine);
    } else {
      currentLines.push(rawLine);
    }
  }

  flushCurrent();
  return blocks;
}

/**
 * Full Document Normalization & Smart Spacing Pipeline before EPUB assembly.
 *
 * Pipeline stages:
 * 1. Strip repeated running headers, footers, page numbers, and artificial page-break tags.
 * 2. Detect & reorder multi-column pages into natural single-column reading sequence.
 * 3. Identify intentional chapter starts vs continuation pages.
 * 4. Reconstruct paragraphs and split Bengali words continuing across PDF page boundaries using confidence scoring.
 * 5. Consolidate continuation pages into their parent chapter section while preserving
 *    all anchors, figures, and internal navigation links.
 * 6. Verify lossless content preservation.
 *
 * When `options.smartSpacing === false`, preserves the application's legacy page-by-page
 * section assembly without cross-page paragraph merging.
 */
export interface ReconstructDocumentLayoutOptions {
  bookDetails?: BookDetails;
  structureConfig?: StructureConfig;
  pdfOutline?: PdfOutlineItem[];
  tocTree?: EpubTocItem[];
  identifiedTocPageNums?: Set<number>;
  smartSpacing?: boolean;
}

export function reconstructDocumentLayoutForEpub(
  pages: PageItem[],
  optionsOrTocTree: ReconstructDocumentLayoutOptions | EpubTocItem[] = {},
  maybeOptions?: ReconstructDocumentLayoutOptions
): DocumentLayoutReconstructionResult {
  const options: ReconstructDocumentLayoutOptions = Array.isArray(optionsOrTocTree)
    ? { ...(maybeOptions || {}), tocTree: optionsOrTocTree }
    : optionsOrTocTree || {};

  const smartSpacingEnabled = options.smartSpacing !== false;
  const warnings: string[] = [];
  const decisions: PageBoundaryMergeDecision[] = [];

  const tocPageNumbers = new Set<number>(options.identifiedTocPageNums || []);
  // Also include pages explicitly marked isTocPage if they have genuine TOC heading/entries
  for (const p of pages || []) {
    if (p && p.isTocPage && p.markdown) {
      const firstLines = p.markdown
        .split('\n')
        .map((l) => l.replace(/^[#*\s]+|[#*\s]+$/g, '').trim())
        .filter(Boolean)
        .slice(0, 6);
      const hasStandaloneTocHeading = firstLines.some(
        (l) =>
          l.length <= 40 &&
          /^(?:সূচিপত্র|সূচি|সূচীপত্র|সূচী|বিষয়সূচি|বিষয়সূচি|বিষয়বস্তু|বিষয়বস্তু|table of contents|contents|index)$/i.test(
            l
          )
      );
      if (hasStandaloneTocHeading) {
        tocPageNumbers.add(p.pageNumber);
      }
    }
  }
  const tocTargetPages = collectTocTargetPageNumbers(options.tocTree || []);

  // When Smart Spacing is disabled (OFF), preserve original page-by-page assembly
  if (!smartSpacingEnabled) {
    const rawContentPages = (pages || []).filter(
      (p) => p && p.status !== 'excluded' && p.markdown && p.markdown.trim().length > 0 && !tocPageNumbers.has(p.pageNumber)
    );
    const pageToSectionFileMap = new Map<
      number,
      { sectionPageNumber: number; targetFile: string; needsPageAnchor: boolean }
    >();
    const consolidatedGroups: ConsolidatedPageGroup[] = rawContentPages.map((page) => {
      pageToSectionFileMap.set(page.pageNumber, {
        sectionPageNumber: page.pageNumber,
        targetFile: `page_${page.pageNumber}.xhtml`,
        needsPageAnchor: false,
      });
      return {
        sectionPage: {
          ...page,
          figures: [...(page.figures || [])],
        },
        sourcePageNumbers: [page.pageNumber],
        figureOriginMap: (page.figures || []).map((fig, fIdx) => ({
          originalPageNumber: page.pageNumber,
          originalFigureIndex: fIdx + 1,
          figure: fig,
        })),
      };
    });

    return {
      consolidatedGroups,
      cleanedPages: pages,
      pageToSectionFileMap,
      report: {
        smartSpacingEnabled: false,
        totalInputPages: rawContentPages.length,
        totalOutputSections: consolidatedGroups.length,
        multiColumnPagesReordered: 0,
        crossPageParagraphsMerged: 0,
        artificialPageBreaksRemoved: 0,
        runningHeadersFootersRemoved: 0,
        emptyElementsRemoved: 0,
        excessiveSpacingNormalized: 0,
        duplicateBoundaryLinesRemoved: 0,
        lowConfidenceBoundariesPreserved: 0,
        uncertainBoundariesCount: 0,
        unhyphenatedWordsReconstructedCount: 0,
        prosePoetryProtectedCount: 0,
        chaptersIntact: true,
        contentLosslessVerified: true,
        decisions: [],
        warnings: [],
      },
    };
  }

  // Stage 1: Strip repeated running headers, footers, and page-boundary artifacts
  const { cleanedPages: headerStrippedPages, removedCount: runningHeadersFootersRemoved } =
    detectAndStripRunningHeadersFooters(pages, options.bookDetails, tocPageNumbers);

  // Stage 2: Reconstruct multi-column reading order on each page
  let multiColumnPagesReordered = 0;
  const columnNormalizedPages = headerStrippedPages.map((page) => {
    if (!page || page.status === 'excluded' || !page.markdown || tocPageNumbers.has(page.pageNumber)) {
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
  let uncertainBoundariesCount = 0;
  let safeToMergeCount = 0;
  let safeToSeparateCount = 0;
  let splitWordsJoinedCount = 0;
  let unhyphenatedWordsReconstructedCount = 0;
  let ambiguousFragmentsPreservedCount = 0;
  let prosePoetryProtectedCount = 0;

  for (let idx = 0; idx < contentPages.length; idx++) {
    const page = contentPages[idx];
    const prevPage = idx > 0 ? contentPages[idx - 1] : undefined;
    const isChapterStart = isIntentionalChapterStartPage(page, idx, tocTargetPages, tocPageNumbers, prevPage);

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

      if (idx > 0 && prevPage) {
        const prevLastBlock = splitMarkdownIntoLogicalBlocks(prevPage.markdown).pop() || '';
        const firstBlock = splitMarkdownIntoLogicalBlocks(page.markdown)[0] || '';
        const structCheck = isStructuralNonMergeBlock(firstBlock, [], { bookDetails: options.bookDetails });
        const boundaryClass: SmartSpacingBoundaryClassification =
          structCheck.structuralKind === 'NEW_HEADING' ? 'NEW_HEADING' : 'NEW_CHAPTER';
        const excerpt = buildBoundaryExcerpt(prevLastBlock, firstBlock);

        safeToSeparateCount++;
        decisions.push({
          fromPage: prevPage.pageNumber,
          toPage: page.pageNumber,
          classification: boundaryClass,
          boundaryDecision: 'SAFE_TO_SEPARATE',
          shouldMergeParagraph: false,
          shouldConsolidateSection: false,
          removeVisualPageGap: false,
          joinSplitWord: false,
          preservedOriginalFragment: false,
          confidence: 'none',
          confidenceLevel: 'LOW',
          score: 0,
          scoreBreakdown: { intentional_chapter_start: 0 },
          signals: ['intentional_chapter_start'],
          nonMergeReason: 'chapter_boundary_preserved',
          diagnostics: {
            originalBoundaryText: excerpt,
            proposedReconstruction: excerpt,
            finalDecision: 'PRESERVED_SEPARATE_BLOCKS',
            confidenceLevel: 'LOW',
            confidenceScore: 0,
            scoreBreakdown: { intentional_chapter_start: 0 },
            reason: 'chapter_boundary_preserved',
            evidenceUsed: ['intentional_chapter_start'],
            visualVerificationPerformed: false,
          },
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

    const isPageAnchorBlock = (b: string) =>
      /^<span\s+id=["']page_\d+["']\s+class=["']epub-page-anchor["']><\/span>$/i.test(b.trim());

    let lastPrevTextIdx = -1;
    for (let idx = prevBlocks.length - 1; idx >= 0; idx--) {
      if (!isPageAnchorBlock(prevBlocks[idx])) {
        lastPrevTextIdx = idx;
        break;
      }
    }

    let firstNextTextIdx = -1;
    for (let idx = 0; idx < nextBlocks.length; idx++) {
      if (!isPageAnchorBlock(nextBlocks[idx])) {
        firstNextTextIdx = idx;
        break;
      }
    }

    if (lastPrevTextIdx !== -1 && firstNextTextIdx !== -1) {
      let lastPrevBlock = prevBlocks[lastPrevTextIdx];
      let firstNextBlock = nextBlocks[firstNextTextIdx];

      // Check for accidental duplicate boundary line/paragraph repeated at top of next page
      const normLastPrev = lastPrevBlock.replace(/\s+/g, ' ').trim();
      const normFirstNext = firstNextBlock.replace(/\s+/g, ' ').trim();

      if (normLastPrev.length >= 20 && normLastPrev === normFirstNext) {
        nextBlocks.splice(firstNextTextIdx, 1);
        duplicateBoundaryLinesRemoved++;
        firstNextTextIdx = nextBlocks.findIndex((b) => !isPageAnchorBlock(b));
        firstNextBlock = firstNextTextIdx !== -1 ? nextBlocks[firstNextTextIdx] : '';
      }

      if (firstNextBlock && firstNextTextIdx !== -1) {
        const mergeEval = evaluateParagraphContinuation(lastPrevBlock, firstNextBlock, {
          isPageBoundary: true,
          nextPageIsChapterStart: false,
          prevPageBlocks: prevBlocks.filter((b) => !isPageAnchorBlock(b)),
          nextPageBlocks: nextBlocks.filter((b) => !isPageAnchorBlock(b)),
          bookDetails: options.bookDetails,
          prevPageLayoutBlocks: prevPage?.layoutBlocks,
          nextPageLayoutBlocks: page.layoutBlocks,
        });

        if (mergeEval.boundaryDecision === 'SAFE_TO_MERGE') {
          safeToMergeCount++;
        } else if (mergeEval.boundaryDecision === 'SAFE_TO_SEPARATE') {
          safeToSeparateCount++;
        } else {
          uncertainBoundariesCount++;
        }

        if (mergeEval.joinSplitWord) {
          splitWordsJoinedCount++;
          if (
            mergeEval.signals.includes('reconstructed_unhyphenated_bound_suffix_word') ||
            mergeEval.signals.includes('reconstructed_unhyphenated_verified_split_word')
          ) {
            unhyphenatedWordsReconstructedCount++;
          }
        }
        if (mergeEval.classification === 'UNCERTAIN' && mergeEval.preservedOriginalFragment) {
          ambiguousFragmentsPreservedCount++;
        }
        if (
          mergeEval.signals.some((s) => s.includes('prose_poetry') || s.includes('poetry_or_verse'))
        ) {
          prosePoetryProtectedCount++;
        }

        decisions.push({
          fromPage: prevSourcePageNum,
          toPage: page.pageNumber,
          classification: mergeEval.classification,
          boundaryDecision: mergeEval.boundaryDecision,
          shouldMergeParagraph: mergeEval.shouldMerge,
          shouldConsolidateSection: true,
          removeVisualPageGap: mergeEval.removeVisualPageGap,
          joinSplitWord: mergeEval.joinSplitWord,
          preservedOriginalFragment: mergeEval.preservedOriginalFragment,
          confidence: mergeEval.confidence,
          confidenceLevel: mergeEval.confidenceLevel,
          score: mergeEval.score,
          scoreBreakdown: mergeEval.scoreBreakdown,
          signals: mergeEval.signals,
          nonMergeReason: mergeEval.nonMergeReason,
          diagnostics: mergeEval.diagnostics,
        });

        if (mergeEval.shouldMerge && mergeEval.mergedText) {
          // Merge the split paragraph across the PDF page boundary (supporting 2, 3, 4+ consecutive pages)!
          // Place the page anchor marker outside the merged paragraph so it never splits <p> elements
          prevBlocks[lastPrevTextIdx] = mergeEval.mergedText;
          crossPageParagraphsMerged++;

          const remainingNext = nextBlocks.filter((_, idx) => idx !== firstNextTextIdx);
          const pageAnchorMarker = `<span id="page_${page.pageNumber}" class="epub-page-anchor"></span>`;
          const combinedBlocks =
            remainingNext.length > 0
              ? [...prevBlocks, pageAnchorMarker, ...remainingNext]
              : [
                  ...prevBlocks.slice(0, lastPrevTextIdx),
                  pageAnchorMarker,
                  prevBlocks[lastPrevTextIdx],
                  ...prevBlocks.slice(lastPrevTextIdx + 1),
                ];
          currentGroup.sectionPage.markdown = combinedBlocks.join('\n\n');
        } else {
          // Keep paragraphs/stanzas distinct, but flow them continuously in the same chapter section without a spine break
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
  // Output word count may be slightly smaller by hyphen/unhyphenated joined split words (1 word instead of 2 halves) or deduplicated boundary lines
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
      smartSpacingEnabled: true,
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
      uncertainBoundariesCount,
      safeToMergeCount,
      safeToSeparateCount,
      splitWordsJoinedCount,
      unhyphenatedWordsReconstructedCount,
      ambiguousFragmentsPreservedCount,
      prosePoetryProtectedCount,
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
      let newAnchorId = node.anchorId;
      const mapping = pageToSectionFileMap.get(node.targetPageNumber);

      if (mapping) {
        const [, existingAnchor] = (node.targetHref || '').split('#');
        const effectiveAnchor = existingAnchor || node.anchorId;
        if (effectiveAnchor) {
          newHref = `${mapping.targetFile}#${effectiveAnchor}`;
          newAnchorId = effectiveAnchor;
        } else if (mapping.needsPageAnchor) {
          newAnchorId = `page_${node.targetPageNumber}`;
          newHref = `${mapping.targetFile}#${newAnchorId}`;
        } else {
          newHref = mapping.targetFile;
        }
      }

      return {
        ...node,
        anchorId: newAnchorId,
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
