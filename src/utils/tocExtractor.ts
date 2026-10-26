/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PageItem,
  BookDetails,
  StructureConfig,
  EpubTocItem,
  PdfOutlineItem,
  TocDiagnostics,
} from '../types';
import {
  parseBengaliOrEnglishNumber,
  numberToBengaliDigits,
  detectDocumentLanguage,
  getTocTitleForLanguage,
  extractHeadingsFromMarkdown,
  createHeadingAnchorId,
  cleanHeadingText,
} from './epubGenerator';

/**
 * Multilingual dictionary of known Table of Contents keywords and labels.
 * Stage A: Detect the Original TOC.
 */
export const MULTILINGUAL_TOC_LABELS: string[] = [
  // Bengali
  'সূচিপত্র',
  'সূচীপত্র',
  'বিষয়সূচি',
  'বিষয়সূচি',
  'বিষয়বস্তু',
  'বিষয়বস্তু',
  'সূচি',
  'সূচী',
  'অনুক্রমণিকা',
  'সূচী-পত্র',
  'সূচি-পত্র',
  // English
  'table of contents',
  'contents',
  'detailed contents',
  'brief contents',
  'toc',
  // Hindi / Sanskrit
  'विषय-सूची',
  'विषय सूची',
  'अनुक्रमणिका',
  'विषयानुक्रमणी',
  // Arabic
  'الفهرس',
  'فهرس المحتويات',
  'محتويات',
  'فهرس',
  // French
  'table des matières',
  'table des matieres',
  'sommaire',
  // German
  'inhaltsverzeichnis',
  'inhalt',
  // Spanish & Portuguese
  'índice',
  'indice',
  'tabla de materias',
  'tabla de contenido',
  'sumario',
  'sumário',
  // Italian
  'indice generale',
  'sommario',
];

/**
 * Candidate TOC entry representing an extracted candidate from the detected TOC region.
 */
export interface TocCandidate {
  title: string;
  cleanTitle: string;
  printedPageNumber?: number;
  targetPageNumber?: number;
  level: 1 | 2 | 3 | 4;
  confidence: number;
  source: 'pdf_outline' | 'explicit_toc_page' | 'detected_toc_page' | 'body_fallback';
  evidence: string[];
  rawLine: string;
  sourcePageNumber: number;
  anchorId?: string;
  targetHref?: string;
}

/**
 * Complete extraction result including the validated tree, diagnostics, and extraction metadata.
 */
export interface TocExtractionResult {
  tree: EpubTocItem[];
  diagnostics: TocDiagnostics;
  tocPages: number[];
  isFallback: boolean;
  totalEntries: number;
}

/**
 * Checks whether a line or phrase matches a known Table of Contents label across all supported languages.
 */
export function isTableOfContentsLabel(text: string): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/[#*_\-\–—:।.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return false;

  for (const label of MULTILINGUAL_TOC_LABELS) {
    if (clean === label) return true;
    if (clean.startsWith(label + ' ') || clean.endsWith(' ' + label)) return true;
    if (label.includes(' ') && clean.includes(label)) return true;
  }
  return false;
}

/**
 * Stage A: Detect the Original TOC section / pages.
 * Analyzes the document using the following hierarchy:
 * 1. Explicitly configured TOC pages in structureConfig (e.g. "2, 3" or "2-3").
 * 2. Pages marked page.isTocPage === true.
 * 3. Pages containing recognized TOC labels near the top with structured entry layout.
 * 4. Multi-page continuation detection (Stage C).
 */
export function detectTocPages(
  pages: PageItem[],
  structureConfig?: StructureConfig
): number[] {
  if (!pages || pages.length === 0) return [];

  const identifiedSet = new Set<number>();

  // 1. Check user-configured explicit TOC pages from structureConfig (e.g. "2, 3", "2-4")
  if (structureConfig?.tocPagesStr && structureConfig.tocPagesStr.trim()) {
    const rawTokens = structureConfig.tocPagesStr.split(/[,;\s]+/);
    for (const token of rawTokens) {
      if (token.includes('-')) {
        const [startStr, endStr] = token.split('-');
        const s = parseInt(startStr, 10);
        const e = parseInt(endStr, 10);
        if (!isNaN(s) && !isNaN(e) && s <= e) {
          for (let p = s; p <= e; p++) {
            if (pages.some((item) => item.pageNumber === p)) {
              identifiedSet.add(p);
            }
          }
        }
      } else {
        const p = parseInt(token, 10);
        if (!isNaN(p) && pages.some((item) => item.pageNumber === p)) {
          identifiedSet.add(p);
        }
      }
    }
    if (identifiedSet.size > 0) {
      return Array.from(identifiedSet).sort((a, b) => a - b);
    }
  }

  // 2. Check pages explicitly marked with isTocPage: true
  for (const page of pages) {
    if (page && page.isTocPage && page.status !== 'excluded') {
      identifiedSet.add(page.pageNumber);
    }
  }

  // 3. Scan front-matter pages (typically within the first 15 pages) for genuine TOC headings
  const scanLimit = Math.min(pages.length, 25);
  for (let idx = 0; idx < scanLimit; idx++) {
    const page = pages[idx];
    if (!page || page.status === 'excluded' || !page.markdown) continue;

    const lines = page.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // Check first 5 non-empty lines for TOC label
    let foundLabel = false;
    for (let lIdx = 0; lIdx < Math.min(5, lines.length); lIdx++) {
      const line = lines[lIdx];
      if (isTableOfContentsLabel(line)) {
        foundLabel = true;
        break;
      }
    }

    if (foundLabel) {
      // Validate that this page actually contains structured TOC entries,
      // not merely a passing mention of the word 'সূচিপত্র' in a paragraph.
      let validCandidateCount = 0;
      for (const line of lines) {
        if (parseTocLineCandidate(line, page.pageNumber)) {
          validCandidateCount++;
        }
      }

      // If at least 2 lines match the structured entry pattern, accept as TOC page
      if (validCandidateCount >= 2) {
        identifiedSet.add(page.pageNumber);

        // Stage C: Check for multi-page TOC continuation on consecutive pages
        let nextIdx = idx + 1;
        while (nextIdx < scanLimit) {
          const nextPage = pages[nextIdx];
          if (!nextPage || nextPage.status === 'excluded' || !nextPage.markdown) break;

          const nextLines = nextPage.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
          if (nextLines.length === 0) break;

          // If next page starts with a major chapter heading or narrative text, TOC has ended
          const firstLine = nextLines[0];
          if (/^(?:#+\s*)?(?:Chapter|অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব)\s+[০-৯0-9IVXLCDM]+/i.test(firstLine)) {
            break;
          }

          let nextCandidateCount = 0;
          for (const line of nextLines) {
            if (parseTocLineCandidate(line, nextPage.pageNumber)) {
              nextCandidateCount++;
            }
          }

          // Continuation criteria: has a continuation label OR has at least 3 valid entries with high density
          const hasContinuationHeader =
            isTableOfContentsLabel(firstLine) ||
            /সূচিপত্র\s*[\(\[]?(?:চলমান|পরবর্তী|২য়\s*অংশ)/i.test(firstLine) ||
            /contents\s*[\(\[]?(?:cont|continued)/i.test(firstLine);

          if (hasContinuationHeader || nextCandidateCount >= 3) {
            identifiedSet.add(nextPage.pageNumber);
            nextIdx++;
          } else {
            // TOC section has ended
            break;
          }
        }
      }
    }
  }

  return Array.from(identifiedSet).sort((a, b) => a - b);
}

/**
 * Stage B: Extract Only Genuine TOC Entries.
 * Parses a single line from an identified TOC page.
 * Returns null if the line is not a valid candidate.
 */
export function parseTocLineCandidate(
  rawLine: string,
  sourcePageNumber: number
): TocCandidate | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // Negative Filter 1: TOC Page Title / Header itself is NOT an entry
  if (isTableOfContentsLabel(trimmed)) return null;
  if (/^(?:#+\s*)?(?:সূচিপত্র|সূচীপত্র|বিষয়সূচি|বিষয়সূচি|contents|table of contents|فهرس)\b/i.test(trimmed)) {
    return null;
  }

  // Negative Filter 2: Column Headers (e.g. 'ক্রমিক | বিষয় | পৃষ্ঠা' or 'Subject ...... Page')
  if (
    /^(?:ক্রমিক(?:\s*নং)?|নং|no\.?)\s*[|–—\-:]/i.test(trimmed) ||
    /^(?:বিষয়|বিষয়|অধ্যায়|অধ্যায়|chapter|title)\s*[\.\-–—\s|]+\s*(?:পৃষ্ঠা|পেজ|page)$/i.test(trimmed) ||
    /^(?:পৃষ্ঠা|পেজ|page)\s*$/i.test(trimmed)
  ) {
    return null;
  }

  // Negative Filter 3: Section dividers (* * *, ---, ===)
  if (/^[-=—–_*.]{3,}$/.test(trimmed)) return null;

  // Negative Filter 4: Watermark URLs or scanner footers
  if (
    /www\.|https?:\/\/|\.(?:com|org|net|info|bd|in|edu|gov)\b/i.test(trimmed) ||
    /(?:camscanner|tapscanner|amarboi|scan by|scanned by)\b/i.test(trimmed)
  ) {
    return null;
  }

  // Negative Filter 5: Running page numbers or footers ending with "| পৃষ্ঠা X" or "| Page X"
  if (/\|\s*(?:পৃষ্ঠা|পেজ|page)\s*[০-৯0-9]+/i.test(trimmed) || /^[-—–~|\s\.\*]*[০-৯0-9]{1,4}[-—–~|\s\.\*।]*$/.test(trimmed)) {
    return null;
  }

  // Detect indentation from leading spaces or tabs
  const leadingSpaces = rawLine.match(/^\s*/)?.[0]?.replace(/\t/g, '  ').length || 0;

  let rawTitle: string | null = null;
  let parsedPage: number | undefined = undefined;
  let separatorPattern: string = 'none';

  // Pattern 1: Title followed by leader dots/dashes (2 or more) and page number
  // e.g. "প্রথম অধ্যায় ................... ১২" or "Chapter 1 — 15"
  const matchWithDots = trimmed.match(
    /^(?:[-*•\d\.\)]\s*)?(.+?)(?:[\.\s\-_–—~·•]{2,}|\s+(?:পৃষ্ঠা|পেজ|page)\s*|\s*[\-–—]\s*)(?:(?:পৃষ্ঠা|পেজ|page)\s*)?([০-৯0-9]+)\s*$/i
  );
  if (matchWithDots) {
    rawTitle = matchWithDots[1].trim();
    const pageNum = parseBengaliOrEnglishNumber(matchWithDots[2]);
    if (pageNum !== null) {
      parsedPage = pageNum;
      separatorPattern = 'dots_or_dashes';
    }
  }

  // Pattern 2: Title with trailing page number in parentheses or brackets
  // e.g. "ভূমিকা (পৃষ্ঠা ৫)" or "Introduction [p. 10]"
  if (!rawTitle) {
    const matchParentheses = trimmed.match(
      /^(?:[-*•]\s*)?(.+?)\s*[\(\[](?:(?:পৃষ্ঠা|পেজ|page|p\.?)\s*)?([০-৯0-9]+)[\)\]]\s*$/i
    );
    if (matchParentheses) {
      rawTitle = matchParentheses[1].trim();
      const pageNum = parseBengaliOrEnglishNumber(matchParentheses[2]);
      if (pageNum !== null) {
        parsedPage = pageNum;
        separatorPattern = 'parentheses';
      }
    }
  }

  // Pattern 3: Distinct title separated by whitespace ending in a page number
  // Must have at least 3 characters in title, and title must not end with regular punctuation
  if (!rawTitle) {
    const matchTrailingNumber = trimmed.match(
      /^(?:[-*•]\s*)?(.{3,})\s+(?:(?:পৃষ্ঠা|পেজ|page)\s*)?([০-৯0-9]{1,4})\s*$/i
    );
    if (matchTrailingNumber) {
      const candidateTitle = matchTrailingNumber[1].trim().replace(/[\.\-_–—\s]+$/, '');
      // Avoid false positive on normal sentences ending in a number (e.g. "in the year 1995.")
      const isSentence = /[।\?!,;]$/.test(candidateTitle) || candidateTitle.split(/\s+/).length > 12;
      if (!isSentence) {
        const pageNum = parseBengaliOrEnglishNumber(matchTrailingNumber[2]);
        if (pageNum !== null && pageNum > 0 && pageNum < 5000) {
          rawTitle = candidateTitle;
          parsedPage = pageNum;
          separatorPattern = 'space_number';
        }
      }
    }
  }

  // Pattern 4: Unnumbered entry on TOC page (e.g. "ভূমিকা", "পরিশিষ্ট", "উৎসর্গ", "উপসংহার")
  if (!rawTitle) {
    const isFrontBackMatter =
      /^(?:Preface|Foreword|Introduction|Prologue|Dedication|Epilogue|Conclusion|Afterword|Appendix(?:\s+[A-Z0-9]+)?|Appendices|Bibliography|Glossary|Index)\b/i.test(trimmed) ||
      /^(?:ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উৎসর্গ|লেখকের কথা|প্রকাশকের কথা|উপসংহার|পরিশিষ্ট(?:\s+[ক-ঞ০-৯\d]+)?|নির্ঘণ্ট|গ্রন্থপঞ্জি)\b/i.test(trimmed);

    if (isFrontBackMatter && trimmed.length <= 50) {
      rawTitle = trimmed;
      separatorPattern = 'frontmatter_keyword';
    }
  }

  if (!rawTitle) return null;

  // Clean title prefix (strip leading bullet points, dashes)
  const cleanTitle = cleanTocTitle(rawTitle);
  if (!cleanTitle || cleanTitle.length < 2) return null;

  // Determine Hierarchy Level:
  // Level 1: Major Parts, Volumes, Books, or Chapters
  // Level 2: Sections, Sub-chapters
  // Level 3: Subsections
  // Level 4: Deep Subsections
  let level: 1 | 2 | 3 | 4 = 1;

  // Check 1: 3-part numbering like "১.১.১" or "1.1.1" -> Level 3
  if (/^[০-৯0-9]+\.[০-৯0-9]+\.[০-৯0-9]+/i.test(cleanTitle)) {
    level = 3;
  }
  // Check 2: 2-part numbering like "১.১", "1.1" -> Level 2
  else if (/^[০-৯0-9]+\.[০-৯0-9]+/i.test(cleanTitle)) {
    level = 2;
  }
  // Check 3: Sub-section prefixes: (ক), (খ), ক., খ., (i), (ii), etc. -> Level 2
  else if (/^(?:[\(\[]?[ক-ঞa-zA-Z][\)\]\.]|[-*•])\s+/i.test(cleanTitle)) {
    level = 2;
  }
  // Check 4: Indentation: >= 4 spaces -> Level 3, >= 2 spaces -> Level 2
  else if (leadingSpaces >= 4) {
    level = 3;
  } else if (leadingSpaces >= 2) {
    level = 2;
  }
  // Check 5: Keywords indicating sub-chapter or section
  else if (/^(?:উপ-?অধ্যায়|উপ-?অধ্যায়|পরিচ্ছেদ|অনুচ্ছেদ|অংশ|Section|Subsection)\b/i.test(cleanTitle)) {
    level = 2;
  }

  // Calculate evidence score
  let confidence = 0.5;
  const evidence: string[] = [];

  if (parsedPage !== undefined) {
    confidence += 0.3;
    evidence.push(`printed_page:${parsedPage}`);
  }
  if (separatorPattern === 'dots_or_dashes') {
    confidence += 0.15;
    evidence.push('leader_dots_separator');
  }
  if (/^(?:অধ্যায়|অধ্যায়|chapter|পর্ব|part|ভূমিকা|পরিচ্ছেদ|[০-৯0-9]+[\.\)])/i.test(cleanTitle)) {
    confidence += 0.1;
    evidence.push('structured_keyword_or_number');
  }

  return {
    title: rawTitle,
    cleanTitle,
    printedPageNumber: parsedPage,
    level,
    confidence: Math.min(1.0, confidence),
    source: 'detected_toc_page',
    evidence,
    rawLine,
    sourcePageNumber,
  };
}

/**
 * Cleans and normalizes TOC entry title.
 */
export function cleanTocTitle(text: string): string {
  if (!text) return '';
  return text
    .replace(/^[-*•·~]+\s*/, '')
    .replace(/<[^>]+>/g, '') // remove HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stage D: Validate Every Entry.
 * Strictly verifies candidate against negative rules.
 */
export function validateTocCandidate(candidate: TocCandidate): { isValid: boolean; reason?: string } {
  if (!candidate || !candidate.cleanTitle) {
    return { isValid: false, reason: 'empty_title' };
  }

  const title = candidate.cleanTitle;

  // Length check
  if (title.length < 2) {
    return { isValid: false, reason: 'too_short' };
  }
  if (title.length > 140) {
    return { isValid: false, reason: 'too_long_likely_paragraph' };
  }

  // Reject ordinary body paragraphs or full sentences ending with sentence punctuation
  if (/[।\?!]$/.test(title) && !/^(?:অধ্যায়|অধ্যায়|Chapter)\b/i.test(title)) {
    // If it's a long sentence ending in dandi, it's body text
    if (title.split(/\s+/).length > 8) {
      return { isValid: false, reason: 'sentence_punctuation_body_text' };
    }
  }

  // Reject captions
  if (/^(?:চিত্র|ছবি|চিত্রাঙ্কন|Fig|Figure|Table|সারণী|ডায়াগ্রাম|মানচিত্র)\s*[:০-৯0-9]/i.test(title)) {
    return { isValid: false, reason: 'figure_caption' };
  }

  // Reject footnotes
  if (/^\[\^[০-৯0-9a-z]+\]/i.test(title) || /^[*†‡]\s+/i.test(title)) {
    return { isValid: false, reason: 'footnote' };
  }

  // Reject ISBN / Copyright / Publisher meta lines
  if (
    /^(?:ISBN|ISSN|সর্বস্বত্ব|All rights reserved|প্রকাশকাল|মুদ্রণ|মূল্য|Price)\b/i.test(title) ||
    /^(?:প্রকাশক|মুদ্রক|প্রচ্ছদ শিল্পী|কম্পোজ|বর্ণবিন্যাস)\s*[:।]/i.test(title)
  ) {
    return { isValid: false, reason: 'publication_metadata' };
  }

  // Reject URLs, websites, and scanner watermarks
  if (
    /www\.|https?:\/\/|\.(?:com|org|net|info|bd|in|edu|gov)\b/i.test(title) ||
    /(?:camscanner|tapscanner|amarboi|scanned by|scan by)\b/i.test(title)
  ) {
    return { isValid: false, reason: 'watermark_or_url' };
  }

  // Reject running footers with vertical bars or page numbers
  if (
    /\|\s*(?:পৃষ্ঠা|পেজ|page)\s*[০-৯0-9]+/i.test(title) ||
    /^(?:পৃষ্ঠা|পেজ|page)\s*[:।\-–—~.]*\s*[০-৯0-9]+/i.test(title)
  ) {
    return { isValid: false, reason: 'running_footer_page_number' };
  }

  // Reject repeated TOC titles
  if (isTableOfContentsLabel(title)) {
    return { isValid: false, reason: 'repeated_toc_header' };
  }

  // Confidence threshold: must be >= 0.6
  if (candidate.confidence < 0.6) {
    return { isValid: false, reason: 'insufficient_confidence' };
  }

  return { isValid: true };
}

/**
 * Resolves destination pages and anchor IDs for extracted TOC candidates.
 * Stage 5: Link to Correct Locations.
 */
export function resolveTocDestinations(
  candidates: TocCandidate[],
  contentPages: PageItem[]
): {
  resolvedCandidates: TocCandidate[];
  resolvedCount: number;
  unresolvedCount: number;
} {
  if (!contentPages || contentPages.length === 0) {
    return {
      resolvedCandidates: candidates,
      resolvedCount: 0,
      unresolvedCount: candidates.length,
    };
  }

  let resolvedCount = 0;
  let unresolvedCount = 0;

  // Pre-calculate page headings map: pageNumber -> ExtractedHeading[]
  const pageHeadingsMap = new Map<number, ReturnType<typeof extractHeadingsFromMarkdown>>();
  for (const page of contentPages) {
    if (page.markdown) {
      pageHeadingsMap.set(page.pageNumber, extractHeadingsFromMarkdown(page.markdown, page.pageNumber));
    }
  }

  // Step 1: Detect offset between printed page numbers and PDF page numbers
  // In published books: PDF page = Printed page + Offset
  const observedOffsets: number[] = [];
  for (const c of candidates) {
    if (c.printedPageNumber === undefined) continue;

    const searchNorm = normalizeForMatch(c.cleanTitle);
    if (searchNorm.length < 3) continue;

    // Search for page where this title appears as a heading
    for (const page of contentPages) {
      const headings = pageHeadingsMap.get(page.pageNumber) || [];
      const matchedH = headings.find((h) => {
        const hNorm = normalizeForMatch(h.title);
        return hNorm.includes(searchNorm) || searchNorm.includes(hNorm);
      });

      if (matchedH) {
        const offset = page.pageNumber - c.printedPageNumber;
        if (offset >= 0 && offset <= 25) {
          observedOffsets.push(offset);
        }
        break;
      }
    }
  }

  // Compute dominant offset (mode or median)
  let dominantOffset = 0;
  if (observedOffsets.length > 0) {
    const counts = new Map<number, number>();
    for (const off of observedOffsets) {
      counts.set(off, (counts.get(off) || 0) + 1);
    }
    let maxCount = 0;
    for (const [off, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantOffset = off;
      }
    }
  }

  // Step 2: Resolve each candidate to a target page and anchor
  const resolvedList: TocCandidate[] = [];

  for (const c of candidates) {
    const searchNorm = normalizeForMatch(c.cleanTitle);
    let matchedPageNumber: number | null = null;
    let matchedAnchorId: string | undefined = undefined;

    // 1. Try exact or fuzzy heading match across content pages
    if (searchNorm.length >= 3) {
      for (const page of contentPages) {
        const headings = pageHeadingsMap.get(page.pageNumber) || [];
        const matchedH = headings.find((h) => {
          const hNorm = normalizeForMatch(h.title);
          return hNorm === searchNorm || hNorm.includes(searchNorm) || searchNorm.includes(hNorm);
        });

        if (matchedH) {
          matchedPageNumber = page.pageNumber;
          matchedAnchorId = matchedH.anchorId;
          break;
        }
      }
    }

    // 2. If no direct heading match, use printed page number with calculated offset
    if (!matchedPageNumber && c.printedPageNumber !== undefined) {
      const estimatedPdfPage = c.printedPageNumber + dominantOffset;
      const targetPage = contentPages.find((p) => p.pageNumber === estimatedPdfPage) ||
        contentPages.find((p) => p.pageNumber === c.printedPageNumber);

      if (targetPage) {
        matchedPageNumber = targetPage.pageNumber;
        // Check if any heading on target page matches partially
        const headings = pageHeadingsMap.get(targetPage.pageNumber) || [];
        if (headings.length > 0) {
          matchedAnchorId = headings[0].anchorId;
        }
      }
    }

    // 3. Fallback: closest sensible page
    if (!matchedPageNumber) {
      unresolvedCount++;
      // Set to first content page as safe reference
      const firstPage = contentPages[0];
      matchedPageNumber = firstPage ? firstPage.pageNumber : 1;
    } else {
      resolvedCount++;
    }

    const filename = `page_${matchedPageNumber}.xhtml`;
    const targetHref = matchedAnchorId ? `${filename}#${matchedAnchorId}` : filename;

    resolvedList.push({
      ...c,
      targetPageNumber: matchedPageNumber,
      anchorId: matchedAnchorId,
      targetHref,
    });
  }

  return {
    resolvedCandidates: resolvedList,
    resolvedCount,
    unresolvedCount,
  };
}

/**
 * Normalizes text for robust title matching (removes numbers, punctuation, extra spaces).
 */
function normalizeForMatch(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^[০-৯0-9\.\s\-–—:]*/, '') // strip leading chapter numbers
    .replace(/[#*_\-\–—:।.,()[\]{}'"`\/\\+=*&^%$#@~|;]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Stage 3: Strict Fallback Strategy.
 * Reconstructs a clean navigation structure ONLY from reliably identifiable chapter headings
 * when no original Table of Contents exists.
 */
export function buildFallbackNavigation(
  contentPages: PageItem[],
  lang: 'bn' | 'en' | 'ar' | 'hi' = 'bn'
): EpubTocItem[] {
  if (!contentPages || contentPages.length === 0) return [];

  const verifiedHeadings: Array<{
    pageNumber: number;
    title: string;
    level: 1 | 2;
    anchorId: string;
  }> = [];

  for (const page of contentPages) {
    if (!page.markdown) continue;

    const lines = page.markdown.split('\n');
    let headingIdx = 0;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      // Negative filters for fallback: Reject body text, quotes, captions, separators
      if (
        trimmed.startsWith('>') ||
        trimmed.startsWith('- ') ||
        trimmed.startsWith('* ') ||
        trimmed.includes('[IMAGE_FIGURE') ||
        /^[-=—–_*.]{3,}$/.test(trimmed)
      ) {
        continue;
      }

      // Fallback Rule 1: Explicit Level 1 Markdown Heading (# Title)
      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        const titleText = cleanHeadingText(trimmed.substring(2));
        if (titleText && titleText.length >= 2 && titleText.length <= 80) {
          headingIdx++;
          const anchorId = createHeadingAnchorId(page.pageNumber, headingIdx, titleText);
          verifiedHeadings.push({
            pageNumber: page.pageNumber,
            title: titleText,
            level: 1,
            anchorId,
          });
          // Typically one major chapter heading per page
          break;
        }
      }

      // Fallback Rule 2: Explicit Chapter / Front-matter keywords at top of page
      const unwrapped = trimmed.replace(/^(\*\*|<strong>|\[center\]|<center>)/i, '').replace(/(\*\*|<\/strong>|\[\/center\]|<\/center>)$/i, '').trim();
      const isUnambiguousChapter =
        /^(?:Chapter|Chapitre|Kapitel)\s+[IVXLCDM\d]+/i.test(unwrapped) ||
        /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|[০-৯\d]+)\s*(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব)|(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব)\s*(?:[০-৯\d]+|[IVXLCDM]+))\b/i.test(unwrapped) ||
        /^(?:Preface|Foreword|Introduction|Prologue|Epilogue|Conclusion|ভূমিকা|মুখবন্ধ|প্রাককথন|উপসংহার)\b/i.test(unwrapped);

      if (isUnambiguousChapter && unwrapped.length <= 70) {
        headingIdx++;
        const titleText = cleanHeadingText(unwrapped);
        const anchorId = createHeadingAnchorId(page.pageNumber, headingIdx, titleText);
        verifiedHeadings.push({
          pageNumber: page.pageNumber,
          title: titleText,
          level: 1,
          anchorId,
        });
        break;
      }
    }
  }

  // If even strict chapter detection yielded nothing, use minimal safe page landmark
  if (verifiedHeadings.length === 0) {
    const defaultTitle = lang === 'bn' ? 'মূল গ্রন্থ' : 'Main Content';
    const firstP = contentPages[0];
    return [
      {
        id: 'fallback-main-content',
        title: defaultTitle,
        level: 1,
        targetPageNumber: firstP ? firstP.pageNumber : 1,
        targetHref: `page_${firstP ? firstP.pageNumber : 1}.xhtml`,
        children: [],
      },
    ];
  }

  // Assemble verified headings into tree
  return verifiedHeadings.map((vh, idx) => ({
    id: `fallback-toc-${idx + 1}`,
    title: vh.title,
    level: vh.level,
    targetPageNumber: vh.pageNumber,
    targetHref: `page_${vh.pageNumber}.xhtml#${vh.anchorId}`,
    anchorId: vh.anchorId,
    children: [],
  }));
}

/**
 * Assembles a list of resolved TocCandidates into a clean, properly nested EpubTocItem[] tree.
 * Preserves parts, chapters, sections, and subsections without inventing entries.
 */
export function assembleTocTree(candidates: TocCandidate[]): EpubTocItem[] {
  const tree: EpubTocItem[] = [];
  let currentL1: EpubTocItem | null = null;
  let currentL2: EpubTocItem | null = null;
  let itemCounter = 0;

  for (const c of candidates) {
    itemCounter++;
    const node: EpubTocItem = {
      id: `toc-${itemCounter}`,
      title: c.cleanTitle,
      level: c.level,
      targetPageNumber: c.targetPageNumber || 1,
      targetHref: c.targetHref || `page_${c.targetPageNumber || 1}.xhtml`,
      anchorId: c.anchorId,
      rawLine: c.rawLine,
      children: [],
    };

    if (c.level === 1) {
      tree.push(node);
      currentL1 = node;
      currentL2 = null;
    } else if (c.level === 2) {
      if (currentL1) {
        currentL1.children.push(node);
      } else {
        tree.push(node);
        currentL1 = node;
      }
      currentL2 = node;
    } else {
      // Level 3 or 4
      if (currentL2) {
        currentL2.children.push(node);
      } else if (currentL1) {
        currentL1.children.push(node);
      } else {
        tree.push(node);
      }
    }
  }

  return tree;
}

/**
 * Converts a PDF Outline tree into TocCandidates.
 */
function candidatesFromPdfOutline(
  outline: PdfOutlineItem[],
  level: 1 | 2 | 3 | 4 = 1
): TocCandidate[] {
  const list: TocCandidate[] = [];
  for (const item of outline) {
    const cleanTitle = cleanTocTitle(item.title);
    if (!cleanTitle) continue;

    const pageNum = typeof item.pageNumber === 'number' && item.pageNumber > 0 ? item.pageNumber : undefined;

    list.push({
      title: item.title,
      cleanTitle,
      printedPageNumber: pageNum,
      targetPageNumber: pageNum,
      level,
      confidence: 1.0,
      source: 'pdf_outline',
      evidence: ['native_pdf_bookmark'],
      rawLine: item.title,
      sourcePageNumber: pageNum || 1,
    });

    if (item.items && item.items.length > 0) {
      const nextLevel = Math.min(4, level + 1) as 1 | 2 | 3 | 4;
      list.push(...candidatesFromPdfOutline(item.items, nextLevel));
    }
  }
  return list;
}

/**
 * Master TOC Extraction Engine.
 * Implements all stages (A, B, C, D) and Fallback strategy.
 */
export function extractAuthoritativeTocTree(
  allPages: PageItem[],
  options: {
    pdfOutline?: PdfOutlineItem[];
    structureConfig?: StructureConfig;
    bookDetails?: BookDetails;
  } = {}
): TocExtractionResult {
  const startTime = Date.now();
  const lang = detectDocumentLanguage(allPages, options.bookDetails);

  const diagnostics: TocDiagnostics = {
    outlineFound: false,
    outlineItemCount: 0,
    identifiedTocPages: [],
    extractedEntriesCount: 0,
    validatedEntriesCount: 0,
    duplicatesRemovedCount: 0,
    rejectedCount: 0,
    rejectionReasons: {},
    fallbackUsed: false,
    linksResolvedCount: 0,
    unresolvedCount: 0,
    pipelineDurationMs: 0,
  };

  const validPages = allPages.filter((p) => p.status !== 'excluded');
  const contentPages = allPages.filter((p) => p.status !== 'excluded' && p.markdown && p.markdown.trim().length > 0);
  const detectedTocPageNums = detectTocPages(validPages, options.structureConfig);
  diagnostics.identifiedTocPages = detectedTocPageNums;

  // ----------------------------------------------------
  // Priority 1: Native PDF Outline / Bookmarks
  // ----------------------------------------------------
  if (options.pdfOutline && options.pdfOutline.length > 0) {
    diagnostics.outlineFound = true;
    diagnostics.outlineItemCount = options.pdfOutline.length;

    const outlineCandidates = candidatesFromPdfOutline(options.pdfOutline);
    if (outlineCandidates.length > 0) {
      diagnostics.extractedEntriesCount = outlineCandidates.length;

      // Validate outline entries
      const validCandidates: TocCandidate[] = [];
      for (const cand of outlineCandidates) {
        const val = validateTocCandidate(cand);
        if (val.isValid) {
          validCandidates.push(cand);
        } else {
          diagnostics.rejectedCount++;
          const reason = val.reason || 'unknown';
          diagnostics.rejectionReasons[reason] = (diagnostics.rejectionReasons[reason] || 0) + 1;
        }
      }

      if (validCandidates.length > 0) {
        diagnostics.validatedEntriesCount = validCandidates.length;

        // Filter out physical TOC pages from destination pages so bookmarks don't land on TOC page
        const nonTocContentPages = contentPages.filter(
          (p) => !detectedTocPageNums.includes(p.pageNumber)
        );
        const targetPool = nonTocContentPages.length > 0 ? nonTocContentPages : contentPages;

        const { resolvedCandidates, resolvedCount, unresolvedCount } = resolveTocDestinations(
          validCandidates,
          targetPool
        );
        diagnostics.linksResolvedCount = resolvedCount;
        diagnostics.unresolvedCount = unresolvedCount;

        const tree = assembleTocTree(resolvedCandidates);
        diagnostics.pipelineDurationMs = Date.now() - startTime;

        return {
          tree,
          diagnostics,
          tocPages: detectedTocPageNums,
          isFallback: false,
          totalEntries: resolvedCandidates.length,
        };
      }
    }
  }

  // ----------------------------------------------------
  // Priority 2: Detected or Explicit Original TOC Pages
  // ----------------------------------------------------

  if (detectedTocPageNums.length > 0) {
    const rawCandidates: TocCandidate[] = [];

    for (const pageNum of detectedTocPageNums) {
      const page = validPages.find((p) => p.pageNumber === pageNum);
      if (!page || !page.markdown) continue;

      const lines = page.markdown.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isTableOfContentsLabel(trimmed) || /^#+\s*(?:সূচিপত্র|সূচীপত্র|contents|table of contents)/i.test(trimmed)) {
          continue;
        }
        const parsed = parseTocLineCandidate(line, page.pageNumber);
        if (parsed) {
          rawCandidates.push(parsed);
        } else {
          diagnostics.rejectedCount++;
          diagnostics.rejectionReasons['invalid_format_or_noise'] =
            (diagnostics.rejectionReasons['invalid_format_or_noise'] || 0) + 1;
        }
      }
    }

    diagnostics.extractedEntriesCount = rawCandidates.length;

    // Validate candidates & remove duplicates (Stage D)
    const validatedCandidates: TocCandidate[] = [];
    const seenTitles = new Set<string>();

    for (const cand of rawCandidates) {
      const val = validateTocCandidate(cand);
      if (!val.isValid) {
        diagnostics.rejectedCount++;
        const reason = val.reason || 'unknown';
        diagnostics.rejectionReasons[reason] = (diagnostics.rejectionReasons[reason] || 0) + 1;
        continue;
      }

      // Deduplicate identical title + pageNumber
      const dedupKey = `${normalizeForMatch(cand.cleanTitle)}_${cand.printedPageNumber || 'none'}`;
      if (seenTitles.has(dedupKey)) {
        diagnostics.duplicatesRemovedCount++;
        continue;
      }
      seenTitles.add(dedupKey);
      validatedCandidates.push(cand);
    }

    if (validatedCandidates.length > 0) {
      diagnostics.validatedEntriesCount = validatedCandidates.length;

      // Filter out TOC pages from destination pages so TOC doesn't link back into itself
      const nonTocContentPages = contentPages.filter(
        (p) => !detectedTocPageNums.includes(p.pageNumber)
      );
      const targetPool = nonTocContentPages.length > 0 ? nonTocContentPages : contentPages;

      const { resolvedCandidates, resolvedCount, unresolvedCount } = resolveTocDestinations(
        validatedCandidates,
        targetPool
      );
      diagnostics.linksResolvedCount = resolvedCount;
      diagnostics.unresolvedCount = unresolvedCount;

      const tree = assembleTocTree(resolvedCandidates);
      diagnostics.pipelineDurationMs = Date.now() - startTime;

      return {
        tree,
        diagnostics,
        tocPages: detectedTocPageNums,
        isFallback: false,
        totalEntries: resolvedCandidates.length,
      };
    }
  }

  // ----------------------------------------------------
  // Priority 3: Fallback Mode (Stage 3)
  // When no original TOC is found, use strict Fallback
  // ----------------------------------------------------
  diagnostics.fallbackUsed = true;
  diagnostics.fallbackReason =
    detectedTocPageNums.length === 0
      ? 'মূল বইয়ে কোনো মুদ্রিত সূচিপত্র বা পিডিএফ আউটলাইন পাওয়া যায়নি।'
      : 'সূচিপত্রের পৃষ্ঠা থেকে কোনো নির্ভরযোগ্য এন্ট্রি পাঠোদ্ধার করা যায়নি।';

  const fallbackPages = contentPages.filter(
    (p) => !detectedTocPageNums.includes(p.pageNumber)
  );
  const fallbackTree = buildFallbackNavigation(
    fallbackPages.length > 0 ? fallbackPages : contentPages,
    lang
  );
  diagnostics.validatedEntriesCount = fallbackTree.length;
  diagnostics.linksResolvedCount = fallbackTree.length;
  diagnostics.pipelineDurationMs = Date.now() - startTime;

  return {
    tree: fallbackTree,
    diagnostics,
    tocPages: detectedTocPageNums,
    isFallback: true,
    totalEntries: fallbackTree.length,
  };
}
