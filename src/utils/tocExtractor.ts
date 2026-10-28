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
  CanonicalDocumentOutline,
  UncertainHeadingDiagnostic,
} from '../types';
import {
  parseBengaliOrEnglishNumber,
  numberToBengaliDigits,
  detectDocumentLanguage,
  getTocTitleForLanguage,
  extractHeadingsFromMarkdown,
  createHeadingAnchorId,
  cleanHeadingText,
  classifyHeadingSemanticTypeAndLabel,
  isAmbiguousOrCorruptedHeadingCandidate,
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
 * Checks whether a line or phrase matches a known standalone Table of Contents label across all supported languages.
 * Rejects sentences or chapter titles that merely mention a TOC keyword alongside other topics
 * (e.g. "# সূচিপত্র ও গবেষণা" or "সূচিপত্র নিয়ে একটি আলোচনা").
 */
export function isTableOfContentsLabel(text: string): boolean {
  if (!text) return false;

  // Strip HTML tags and optional continuation parentheticals like (চলমান), (cont.), (continued), (২য় অংশ)
  const withoutTags = text
    .replace(/<[^>]+>/g, '')
    .replace(/[\(\[]\s*(?:চলমান|পরবর্তী|শেষ\s*অংশ|[০-৯0-9]+\s*(?:য়|য়|ম)?\s*অংশ|cont\.?|continued|part\s*\d+)\s*[\)\]]/gi, '')
    .trim();

  const clean = withoutTags
    .toLowerCase()
    .replace(/^[#*_\-\–—:।.,()[\]{}\s]+|[#*_\-\–—:।.,()[\]{}\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean || clean.length > 45) return false;

  // Reject if joined with another topic via conjunctions ("ও", "এবং", "বা", "ইত্যাদি", "and", "or")
  if (/\s+(?:ও|এবং|বা|বনাম|নিয়ে|নিয়ে|সম্পর্কে|প্রসঙ্গে|ইত্যাদি|and|or|vs|about)\s+/i.test(clean)) {
    return false;
  }

  for (const label of MULTILINGUAL_TOC_LABELS) {
    if (clean === label) return true;
    const normalizedDash = clean.replace(/[\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizedLabel = label.replace(/[\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalizedDash === normalizedLabel) return true;
  }
  return false;
}

/**
 * Negative Evidence Helper:
 * Detects whether a line or candidate title contains measurement units, weights, quantities,
 * prices, currencies, ranges, decimals, or catalog/ingredient markers ("ইত্যাদি", "প্রভৃতি", "etc.").
 */
export function isDataValueOrUnitLine(rawLine: string, candidateTitle?: string): boolean {
  const text = `${rawLine || ''} ${candidateTitle || ''}`.replace(/<[^>]+>/g, ' ').trim();
  if (!text) return false;

  // 1. Bengali and English measurement units, weights, quantities, and currencies
  const unitRegex =
    /(?:^|[\s\d০-৯.,/\-–—()])(?:কেজি|কি\.?\s*গ্রা\.?|গ্রাম|মিলিগ্রাম|মিলি|লিটার|সের|মন|মণ|ছটাক|তোলা|রতি|পোয়া|পোয়া|গজ|ফুট|ইঞ্চি|মিটার|সেন্টিমিটার|বিঘা|কাঠা|শতাংশ|টাকা|পয়সা|পয়সা|রুপি|আনা|ডজন|হালি|জোড়া|জোড়া|পিস|বস্তা|প্যাকেট|বোতল|কাপ|চামচ|টেবিল\s*চামচ|চা\s*চামচ|টিস্পুন|টেবিলস্পুন|kg|kgs|gm|gms|gram|grams|mg|ml|ltr|liter|litre|oz|lb|lbs|tk|taka|bdt|rs|inr|usd|pcs|pc|dozen|pack|bottle|tbsp|tsp)(?=$|[\s.,।/\-–—()])/i;
  if (unitRegex.test(text)) {
    return true;
  }

  // 2. Currency symbols or price slash notations (e.g. "৫০/-", "120/=", "৳৫০", "$20", "₹100")
  if (/[৳₹$£€]/.test(text) || /[০-৯0-9]+\s*\/[\-=]/.test(text)) {
    return true;
  }

  // 3. Decimal numbers or fractional quantities (e.g., "১.৫০", "2.5", "১/২", "৩/৪") that are not multi-level section numbers at the start
  const strippedLeadingNumbering = rawLine.trim().replace(/^[০-৯0-9]+(?:\.[০-৯0-9]+)+\s+/, '');
  if (
    /[০-৯0-9]+\.[০-৯0-9]+\s*$/.test(strippedLeadingNumbering) ||
    /(?:^|\s)[০-৯0-9]+\/[০-৯0-9]+(?:\s|$)/.test(strippedLeadingNumbering)
  ) {
    return true;
  }

  // 4. Category or item lines ending with "ইত্যাদি", "প্রভৃতি", "etc."
  const titlePart = (candidateTitle || rawLine).replace(/[০-৯0-9\s\-–—.]+$/g, '').trim();
  if (/(?:ইত্যাদি|প্রভৃতি|etc\.?)$/i.test(titlePart)) {
    return true;
  }

  // 5. Multiple numeric columns in the trailing value section (e.g. "চাল — ১ — ৫০" or "ডাল — ৫০ / ৬০")
  if (/[\-–—]\s*[০-৯0-9]+\s*(?:[\-–—/|]|\s+)\s*[০-৯0-9]+\s*$/.test(rawLine.trim())) {
    return true;
  }

  return false;
}

/**
 * Checks whether a heading or page represents an ordinary categorized list, ingredient list,
 * price list, product catalog, or tabular data page rather than a Table of Contents.
 */
export function isOrdinaryDataListPage(markdown: string): boolean {
  if (!markdown || !markdown.trim()) return false;
  const lines = markdown
    .split('\n')
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  // If the page starts with an explicit standalone TOC label, it is not an ordinary data list page
  const hasExplicitTocLabel = lines.slice(0, 5).some((l) => isTableOfContentsLabel(l));
  if (hasExplicitTocLabel) return false;

  let unitOrPriceLineCount = 0;
  let categoryHeaderCount = 0;
  let dashNumberLineCount = 0;
  let chapterSignalCount = 0;

  for (const line of lines) {
    const cleanHeading = line.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();

    if (isDataValueOrUnitLine(line, cleanHeading)) {
      unitOrPriceLineCount++;
    }

    // Category header patterns like "শস্য এবং ডাল", "মাখন ও চিনি ইত্যাদি", "মসলা ও তেল"
    if (
      /(?:ইত্যাদি|প্রভৃতি|etc\.?)$/i.test(cleanHeading) ||
      (/(?:^#+\s+|^\*\*.+\*\*$)/.test(line) &&
        /\s+(?:ও|এবং|বা|and|&)\s+/i.test(cleanHeading) &&
        !/^(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|সূচিপত্র|ভূমিকা|উপসংহার|chapter|part|section)(?=\s|$|[:।.\-–—])/i.test(cleanHeading))
    ) {
      categoryHeaderCount++;
    }

    if (/^.+?[\-–—]\s*[০-৯0-9]+/.test(line)) {
      dashNumberLineCount++;
    }

    if (
      /^(?:#+\s*)?(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|[০-৯0-9]+)\s*(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড)|(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|chapter|part|section)\s*[০-৯0-9IVXLCDM]+|ভূমিকা|মুখবন্ধ|প্রাককথন|উপসংহার|পরিশিষ্ট|preface|foreword|introduction|epilogue|appendix)(?=\s|$|[:।.\-–—])/i.test(
        cleanHeading
      )
    ) {
      chapterSignalCount++;
    }
  }

  if (unitOrPriceLineCount >= 2 && chapterSignalCount === 0) return true;
  if (categoryHeaderCount >= 1 && (unitOrPriceLineCount >= 1 || dashNumberLineCount >= 2) && chapterSignalCount === 0) {
    return true;
  }

  return false;
}

/**
 * Multi-signal conservative TOC page classification result.
 */
export interface TocPageClassificationResult {
  isTocPage: boolean;
  score: number;
  positiveSignals: string[];
  negativeSignals: string[];
  candidateCount: number;
  matchedDocumentHeadingsCount: number;
  monotonicRatio: number;
}

/**
 * Evaluates whether a page is genuinely a Table of Contents page using multiple independent
 * positive and negative signals (Document Position, Explicit TOC Labels, Structural Cues,
 * Monotonic Page Numbers, Cross-Document Heading Verification, and Negative Unit/Price/List Signals).
 */
export function evaluateTocPageClassification(
  page: PageItem,
  allPages: PageItem[] = [],
  pageIndex?: number
): TocPageClassificationResult {
  const emptyResult: TocPageClassificationResult = {
    isTocPage: false,
    score: 0,
    positiveSignals: [],
    negativeSignals: [],
    candidateCount: 0,
    matchedDocumentHeadingsCount: 0,
    monotonicRatio: 0,
  };

  if (!page || page.status === 'excluded' || !page.markdown || !page.markdown.trim()) {
    return emptyResult;
  }

  const lines = page.markdown
    .split('\n')
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return emptyResult;

  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  let score = 0;

  // Signal A: Document Position (front-matter check)
  const totalPages = allPages.length;
  const resolvedIndex =
    pageIndex !== undefined
      ? pageIndex
      : allPages.findIndex((p) => p && p.pageNumber === page.pageNumber);
  const frontMatterLimit = totalPages > 0 ? Math.max(5, Math.min(20, Math.ceil(totalPages * 0.25))) : 15;
  const isFrontMatter = resolvedIndex === -1 || resolvedIndex < frontMatterLimit;

  if (isFrontMatter) {
    score += 10;
    positiveSignals.push('front_matter_position');
  } else {
    score -= 30;
    negativeSignals.push('late_document_position');
  }

  // Signal B1: Explicit standalone TOC heading near the top of the page
  const hasExplicitTocHeading = lines.slice(0, 6).some((l) => isTableOfContentsLabel(l));
  if (hasExplicitTocHeading) {
    score += 55;
    positiveSignals.push('explicit_toc_heading');
  }

  // Check for ordinary data/price/ingredient list signals
  let unitOrPriceCount = 0;
  let categoryHeaderCount = 0;
  let proseParagraphCount = 0;
  let leaderDotCount = 0;
  let chapterKeywordCount = 0;
  const parsedCandidates: TocCandidate[] = [];

  for (const line of lines) {
    if (isTableOfContentsLabel(line)) continue;

    const cleanH = line.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
    if (isDataValueOrUnitLine(line, cleanH)) {
      unitOrPriceCount++;
      continue;
    }

    if (
      /(?:ইত্যাদি|প্রভৃতি|etc\.?)$/i.test(cleanH) ||
      (/(?:^#+\s+|^\*\*.+\*\*$)/.test(line) &&
        /\s+(?:ও|এবং|বা|and|&)\s+/i.test(cleanH) &&
        !/^(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|সূচিপত্র|ভূমিকা|উপসংহার|chapter|part|section)(?=\s|$|[:।.\-–—])/i.test(cleanH))
    ) {
      categoryHeaderCount++;
    }

    // Long narrative prose sentences
    if (line.length > 120 || (/[।?!]$/.test(line) && line.split(/\s+/).length > 10)) {
      proseParagraphCount++;
    }

    const cand = parseTocLineCandidate(line, page.pageNumber);
    if (cand) {
      const val = validateTocCandidate(cand);
      if (val.isValid) {
        parsedCandidates.push(cand);
        if (cand.evidence.includes('leader_dots_separator') && /[\.·•]{3,}/.test(line)) {
          leaderDotCount++;
        }
        if (cand.evidence.includes('structured_keyword_or_number')) {
          chapterKeywordCount++;
        }
      }
    }
  }

  // Negative Evidence Penalties
  if (unitOrPriceCount > 0) {
    const penalty = unitOrPriceCount * 25;
    score -= penalty;
    negativeSignals.push(`measurement_or_price_units:${unitOrPriceCount}`);
  }

  if (categoryHeaderCount > 0 && !hasExplicitTocHeading) {
    score -= categoryHeaderCount * 25;
    negativeSignals.push(`category_list_headers:${categoryHeaderCount}`);
  }

  if (proseParagraphCount >= 2 && !hasExplicitTocHeading) {
    score -= proseParagraphCount * 15;
    negativeSignals.push(`narrative_prose_blocks:${proseParagraphCount}`);
  }

  const candidateCount = parsedCandidates.length;
  if (candidateCount === 0) {
    return {
      isTocPage: false,
      score,
      positiveSignals,
      negativeSignals: [...negativeSignals, 'no_valid_toc_candidates'],
      candidateCount: 0,
      matchedDocumentHeadingsCount: 0,
      monotonicRatio: 0,
    };
  }

  // Signal B2: Leader dots and chapter keywords
  if (leaderDotCount >= 2) {
    score += 25;
    positiveSignals.push(`leader_dots:${leaderDotCount}`);
  }
  if (chapterKeywordCount >= 2) {
    score += 25;
    positiveSignals.push(`chapter_keywords:${chapterKeywordCount}`);
  } else if (chapterKeywordCount === 1) {
    score += 10;
    positiveSignals.push('chapter_keywords:1');
  }

  // Signal B3: Monotonic Non-Decreasing Page Number Progression
  const pageNumbers = parsedCandidates
    .map((c) => c.printedPageNumber)
    .filter((n): n is number => typeof n === 'number' && n > 0);

  let monotonicPairs = 0;
  let nonMonotonicDrops = 0;
  for (let i = 1; i < pageNumbers.length; i++) {
    if (pageNumbers[i] >= pageNumbers[i - 1]) {
      monotonicPairs++;
    } else {
      nonMonotonicDrops++;
    }
  }
  const monotonicRatio =
    pageNumbers.length >= 2 ? monotonicPairs / (pageNumbers.length - 1) : pageNumbers.length === 1 ? 1 : 0;

  if (pageNumbers.length >= 3) {
    if (monotonicRatio >= 0.8) {
      score += 20;
      positiveSignals.push(`monotonic_page_numbers:${monotonicRatio.toFixed(2)}`);
    } else if (monotonicRatio < 0.5 || nonMonotonicDrops >= 2) {
      score -= 35;
      negativeSignals.push(`non_monotonic_random_numbers:${monotonicRatio.toFixed(2)}`);
    }
  }

  // Signal B4: Cross-Document Heading Verification (with per-page markdown-keyed cache)
  let matchedDocumentHeadingsCount = 0;
  const otherPages = allPages.filter(
    (p) => p && p.status !== 'excluded' && p.pageNumber !== page.pageNumber && p.markdown
  );

  if (otherPages.length > 0) {
    const docHeadingNorms: string[] = [];
    for (const p of otherPages) {
      const pageNorms = getCachedPageHeadingNorms(p);
      for (let k = 0; k < pageNorms.length; k++) {
        docHeadingNorms.push(pageNorms[k]);
      }
    }

    for (const cand of parsedCandidates) {
      const cNorm = normalizeForMatch(cand.cleanTitle);
      if (cNorm.length < 2) continue;
      const matched = docHeadingNorms.some(
        (hNorm) => hNorm === cNorm || hNorm.includes(cNorm) || cNorm.includes(hNorm)
      );
      if (matched) {
        matchedDocumentHeadingsCount++;
      }
    }

    if (matchedDocumentHeadingsCount >= 2) {
      score += 35;
      positiveSignals.push(`matched_document_headings:${matchedDocumentHeadingsCount}`);
    } else if (matchedDocumentHeadingsCount === 1) {
      score += 15;
      positiveSignals.push('matched_document_headings:1');
    } else if (!hasExplicitTocHeading) {
      score -= 25;
      negativeSignals.push('zero_document_heading_matches');
    }
  }

  // Final Conservative Decision Rules:
  // Case 1: Page has an explicit standalone TOC label ("সূচিপত্র", "Table of Contents", "Contents")
  if (hasExplicitTocHeading) {
    const isToc = candidateCount >= 1 && unitOrPriceCount <= candidateCount && score >= 40;
    return {
      isTocPage: isToc,
      score,
      positiveSignals,
      negativeSignals,
      candidateCount,
      matchedDocumentHeadingsCount,
      monotonicRatio,
    };
  }

  // Case 2: Unlabelled page — requires strong converging multi-signal evidence:
  // - Must be in front matter (or single-page snippet evaluation with strong structural cues)
  // - Must have NO measurement/price/currency lines or category list headers
  // - Must have monotonic page numbers (ratio >= 0.8) with at least 3 candidates
  // - Must have either leader dots, chapter keywords, or >= 2 matched headings in the document
  const hasStructuralEvidence =
    leaderDotCount >= 2 || chapterKeywordCount >= 2 || matchedDocumentHeadingsCount >= 2;
  const isUnlabelledToc =
    isFrontMatter &&
    unitOrPriceCount === 0 &&
    categoryHeaderCount === 0 &&
    candidateCount >= 3 &&
    monotonicRatio >= 0.8 &&
    hasStructuralEvidence &&
    (otherPages.length === 0 || matchedDocumentHeadingsCount >= 1) &&
    score >= 55;

  return {
    isTocPage: isUnlabelledToc,
    score,
    positiveSignals,
    negativeSignals,
    candidateCount,
    matchedDocumentHeadingsCount,
    monotonicRatio,
  };
}

const MAX_PAGE_HEADING_NORM_CACHE_SIZE = 600;
const pageHeadingNormCache = new Map<string, string[]>();

function getCachedPageHeadingNorms(p: PageItem): string[] {
  const key = `${p.pageNumber}:${p.markdown}`;
  const cached = pageHeadingNormCache.get(key);
  if (cached) return cached;

  const norms: string[] = [];
  const headings = extractHeadingsFromMarkdown(p.markdown, p.pageNumber);
  for (const h of headings) {
    const norm = normalizeForMatch(h.title);
    if (norm.length >= 2) {
      norms.push(norm);
    }
  }
  const firstLine = p.markdown
    .split('\n')
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .find(Boolean);
  if (firstLine && firstLine.length <= 90) {
    const normFirst = normalizeForMatch(firstLine);
    if (normFirst.length >= 3) {
      norms.push(normFirst);
    }
  }

  if (pageHeadingNormCache.size >= MAX_PAGE_HEADING_NORM_CACHE_SIZE) {
    const oldestKey = pageHeadingNormCache.keys().next().value;
    if (oldestKey !== undefined) {
      pageHeadingNormCache.delete(oldestKey);
    }
  }
  pageHeadingNormCache.set(key, norms);
  return norms;
}

const detectTocPagesCache = new WeakMap<PageItem[], { signature: string; result: number[] }>();

/**
 * Stage A: Detect the Original TOC section / pages.
 * Analyzes the document using the following conservative hierarchy:
 * 1. Explicitly configured TOC pages in structureConfig (e.g. "2, 3" or "2-3").
 * 2. Multi-signal TOC classification on front-matter pages and pages flagged with isTocPage.
 * 3. Multi-page continuation detection (Stage C).
 */
export function detectTocPages(
  pages: PageItem[],
  structureConfig?: StructureConfig
): number[] {
  if (!pages || pages.length === 0) return [];

  const signature = `${structureConfig?.tocPagesStr || ''}|${pages.length}|${pages
    .slice(0, 25)
    .map((p) => `${p?.pageNumber}:${p?.status}:${p?.isTocPage ? 1 : 0}:${p?.markdown?.length || 0}`)
    .join(',')}`;
  const cached = detectTocPagesCache.get(pages);
  if (cached && cached.signature === signature) {
    return cached.result;
  }

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

  // 2. Scan pages using conservative multi-signal classification
  // Never blindly trust page.isTocPage without verifying against negative data-list signals!
  const scanLimit = Math.min(pages.length, 25);
  for (let idx = 0; idx < pages.length; idx++) {
    const page = pages[idx];
    if (!page || page.status === 'excluded' || !page.markdown) continue;

    // Only scan beyond front-matter limit if page was explicitly flagged isTocPage AND has a standalone TOC label
    if (idx >= scanLimit && !page.isTocPage) continue;

    if (isOrdinaryDataListPage(page.markdown)) {
      continue;
    }

    const classification = evaluateTocPageClassification(page, pages, idx);
    if (classification.isTocPage) {
      identifiedSet.add(page.pageNumber);

      // Stage C: Check for multi-page TOC continuation on consecutive pages
      let nextIdx = idx + 1;
      while (nextIdx < scanLimit) {
        const nextPage = pages[nextIdx];
        if (!nextPage || nextPage.status === 'excluded' || !nextPage.markdown) break;
        if (isOrdinaryDataListPage(nextPage.markdown)) break;

        const nextLines = nextPage.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
        if (nextLines.length === 0) break;

        const firstLine = nextLines[0];
        const hasContinuationHeader =
          isTableOfContentsLabel(firstLine) ||
          /^(?:#+\s*)?(?:সূচিপত্র|সূচীপত্র|সূচি|contents|table of contents)\s*[\(\[]?(?:চলমান|পরবর্তী|শেষ\s*অংশ|[০-৯0-9]+\s*(?:য়|য়)?\s*অংশ|cont\.?|continued)/i.test(
            firstLine
          );

        // If next page starts with a Markdown heading (that isn't a TOC continuation header) or a major chapter heading, TOC has ended
        if (
          !hasContinuationHeader &&
          (/^#+\s+/.test(firstLine) ||
            /^(?:#+\s*)?(?:Chapter|অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|ভূমিকা)(?=\s|$|[:।.\-–—])/i.test(firstLine))
        ) {
          break;
        }

        const nextEval = evaluateTocPageClassification(nextPage, pages, nextIdx);
        if (
          hasContinuationHeader ||
          nextEval.isTocPage ||
          (nextEval.candidateCount >= 3 &&
            nextEval.negativeSignals.length === 0 &&
            (nextEval.matchedDocumentHeadingsCount >= 1 || nextEval.monotonicRatio >= 0.8))
        ) {
          identifiedSet.add(nextPage.pageNumber);
          nextIdx++;
        } else {
          break;
        }
      }
    }
  }

  const sortedResult = Array.from(identifiedSet).sort((a, b) => a - b);
  detectTocPagesCache.set(pages, { signature, result: sortedResult });
  return sortedResult;
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

  // Negative Filter 6: Reject measurement units, weights, prices, currencies, and catalog item lines
  if (isDataValueOrUnitLine(trimmed)) {
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
  // Level 2: Sections, Sub-chapters, Bengali alphabetical sections (ক., খ., (ক))
  // Level 3: Subsections (১.১.১ / 1.1.1)
  // Level 4: Deep Subsections (১.১.১.১ / 1.1.1.1)
  let level: 1 | 2 | 3 | 4 = 1;

  // Check 0: 4-part numbering like "১.১.১.১" or "1.1.1.1" -> Level 4
  if (/^[০-৯0-9]+\.[০-৯0-9]+\.[০-৯0-9]+\.[০-৯0-9]+/i.test(cleanTitle)) {
    level = 4;
  }
  // Check 1: 3-part numbering like "১.১.১" or "1.1.1" -> Level 3
  else if (/^[০-৯0-9]+\.[০-৯0-9]+\.[০-৯0-9]+/i.test(cleanTitle)) {
    level = 3;
  }
  // Check 2: 2-part numbering like "১.১", "1.1" -> Level 2
  else if (/^[০-৯0-9]+\.[০-৯0-9]+/i.test(cleanTitle)) {
    level = 2;
  }
  // Check 3: Sub-section prefixes: (ক), (খ), ক., খ., ক), খ), (i), (ii), etc. -> Level 2
  else if (/^(?:[\(\[]?[ক-হa-zA-Z][\)\]\.]|[-*•])\s+/i.test(cleanTitle)) {
    level = 2;
  }
  // Check 4: Indentation: >= 6 spaces -> Level 4, >= 4 spaces -> Level 3, >= 2 spaces -> Level 2
  else if (leadingSpaces >= 6) {
    level = 4;
  } else if (leadingSpaces >= 4) {
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
  if (/^(?:অধ্যায়|অধ্যায়|chapter|পর্ব|part|ভূমিকা|পরিচ্ছেদ|[০-৯0-9]+[\.\)]|[\(\[]?[ক-হ][\)\]\.])/i.test(cleanTitle)) {
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

  // Reject product/ingredient/price/measurement lines
  if (isDataValueOrUnitLine(candidate.rawLine, title)) {
    return { isValid: false, reason: 'data_value_or_measurement_unit' };
  }

  // Reject ambiguous or corrupted OCR heading fragments
  if (isAmbiguousOrCorruptedHeadingCandidate(title)) {
    return { isValid: false, reason: 'corrupted_or_ambiguous_ocr' };
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
 *
 * Priority order:
 * 1. Strong chapter/section number + title match near expected page.
 * 2. Reliable printedPageNumber + dominantOffset mapping.
 * 3. Local window heading match around expected page (handling excluded/shifted pages).
 * 4. Structural & monotonic consistency with preceding and following TOC entries.
 * 5. Mark as unresolved when evidence is absent instead of jumping to distant/unrelated pages.
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
      pageHeadingsMap.set(
        page.pageNumber,
        extractHeadingsFromMarkdown(page.markdown, page.pageNumber, false, page.layoutBlocks)
      );
    }
  }

  const pageNumbersSorted = contentPages.map((p) => p.pageNumber).sort((a, b) => a - b);
  const minContentPage = pageNumbersSorted[0] || 1;
  const maxContentPage = pageNumbersSorted[pageNumbersSorted.length - 1] || 1;

  // Step 1: Detect offset between printed page numbers and PDF physical page numbers
  // Only use high-confidence, non-ambiguous heading matches to estimate the offset.
  const observedOffsets: number[] = [];
  for (const c of candidates) {
    if (c.printedPageNumber === undefined || c.printedPageNumber <= 0) continue;

    const cProfile = buildHeadingMatchProfile(c.cleanTitle);
    if (cProfile.coreNormalized.length < 2 && !cProfile.chapterOrdinal) continue;

    const matchingPages: Array<{ pageNumber: number; score: number }> = [];
    for (const page of contentPages) {
      const headings = pageHeadingsMap.get(page.pageNumber) || [];
      for (const h of headings) {
        const score = scoreTocToHeadingMatch(c.cleanTitle, h.title, c.level, h.level);
        if (score >= 0.9) {
          matchingPages.push({ pageNumber: page.pageNumber, score });
          break;
        }
      }
    }

    // Use unique high-confidence matches (or the match with a distinct chapter number) for offset estimation
    if (matchingPages.length === 1 || (matchingPages.length > 1 && !cProfile.isGenericRecurringTitle)) {
      const bestMatch = matchingPages.sort((a, b) => b.score - a.score)[0];
      const offset = bestMatch.pageNumber - c.printedPageNumber;
      if (offset >= -15 && offset <= 60) {
        observedOffsets.push(offset);
      }
    }
  }

  // Compute dominant offset (mode with median tie-breaking)
  let dominantOffset = 0;
  if (observedOffsets.length > 0) {
    const counts = new Map<number, number>();
    for (const off of observedOffsets) {
      counts.set(off, (counts.get(off) || 0) + 1);
    }
    const sortedOffsets = [...observedOffsets].sort((a, b) => a - b);
    const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];

    let maxCount = 0;
    let bestOffset = medianOffset;
    for (const [off, count] of counts.entries()) {
      if (
        count > maxCount ||
        (count === maxCount && Math.abs(off - medianOffset) < Math.abs(bestOffset - medianOffset))
      ) {
        maxCount = count;
        bestOffset = off;
      }
    }
    dominantOffset = bestOffset;
  }

  // Step 2: Resolve each candidate in sequence while maintaining monotonic page bounds
  const resolvedList: TocCandidate[] = [];
  let lastResolvedPageNumber = minContentPage;
  let lastResolvedL1PageNumber = minContentPage;
  let lastResolvedLevel = 1;
  let activeLocalOffset = dominantOffset;

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    const cProfile = buildHeadingMatchProfile(c.cleanTitle);
    let matchedPageNumber: number | null = null;
    let matchedAnchorId: string | undefined = undefined;
    let resolutionEvidence = '';

    const hasPrintedPage = c.printedPageNumber !== undefined && c.printedPageNumber > 0;
    const expectedPdfPage = hasPrintedPage ? c.printedPageNumber! + activeLocalOffset : undefined;
    const fallbackDirectPdfPage = hasPrintedPage ? c.printedPageNumber! + dominantOffset : undefined;

    // Determine whether the printed page (plus offset) falls within the actual physical pages of this PDF
    const isExpectedPageWithinBook =
      expectedPdfPage !== undefined &&
      expectedPdfPage >= minContentPage - 2 &&
      expectedPdfPage <= maxContentPage + 5;

    // Minimum allowed page based on document reading order (monotonicity)
    const minMonotonicPage =
      idx === 0
        ? minContentPage
        : c.level === 1
        ? lastResolvedL1PageNumber
        : Math.max(lastResolvedL1PageNumber, lastResolvedPageNumber);

    // Upper page bound from the next candidate with a larger printedPageNumber (if within book span)
    let nextExpectedPdfPage: number | undefined = undefined;
    if (hasPrintedPage) {
      for (let nextIdx = idx + 1; nextIdx < candidates.length; nextIdx++) {
        const nextCand = candidates[nextIdx];
        if (
          nextCand.printedPageNumber !== undefined &&
          nextCand.printedPageNumber > c.printedPageNumber!
        ) {
          const candidateNextPdf = nextCand.printedPageNumber + activeLocalOffset;
          if (candidateNextPdf <= maxContentPage + 5) {
            nextExpectedPdfPage = candidateNextPdf;
          }
          break;
        }
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 1 & 3: Local Window Heading Match Around Expected Page
    // -------------------------------------------------------------------------
    if (expectedPdfPage !== undefined && isExpectedPageWithinBook) {
      const windowRadius = 3;
      const candidateWindowPages = contentPages.filter((p) => {
        const nearActive = Math.abs(p.pageNumber - expectedPdfPage) <= windowRadius;
        const nearDominant =
          fallbackDirectPdfPage !== undefined &&
          Math.abs(p.pageNumber - fallbackDirectPdfPage) <= windowRadius;
        const nearRaw = Math.abs(p.pageNumber - c.printedPageNumber!) <= 1;
        return (nearActive || nearDominant || nearRaw) && p.pageNumber >= minMonotonicPage;
      });

      let bestLocalMatch: {
        pageNumber: number;
        anchorId: string;
        score: number;
        distance: number;
      } | null = null;

      for (const page of candidateWindowPages) {
        const headings = pageHeadingsMap.get(page.pageNumber) || [];
        for (const h of headings) {
          const score = scoreTocToHeadingMatch(c.cleanTitle, h.title, c.level, h.level);
          if (score >= 0.76) {
            const distance = Math.abs(page.pageNumber - expectedPdfPage);
            if (
              !bestLocalMatch ||
              score > bestLocalMatch.score + 0.04 ||
              (Math.abs(score - bestLocalMatch.score) <= 0.04 && distance < bestLocalMatch.distance)
            ) {
              bestLocalMatch = {
                pageNumber: page.pageNumber,
                anchorId: h.anchorId,
                score,
                distance,
              };
            }
          }
        }
      }

      if (bestLocalMatch) {
        matchedPageNumber = bestLocalMatch.pageNumber;
        matchedAnchorId = bestLocalMatch.anchorId;
        resolutionEvidence = 'local_window_heading_match';
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 1 & 4: Strong Monotonic Heading Match Across Document
    // (Strictly prevents short substring matches & distant false matches)
    // -------------------------------------------------------------------------
    if (!matchedPageNumber && (cProfile.coreNormalized.length >= 2 || cProfile.chapterOrdinal)) {
      const globalMatches: Array<{
        pageNumber: number;
        anchorId: string;
        score: number;
        headingLevel: number;
      }> = [];

      for (const page of contentPages) {
        // Enforce monotonic progression so later TOC entries never jump back to early chapters
        if (page.pageNumber < minMonotonicPage) continue;

        // If expectedPdfPage is within the book's physical span, reject distant matches (> 10 pages away)
        if (isExpectedPageWithinBook && expectedPdfPage !== undefined) {
          const maxAllowedDrift = cProfile.isGenericRecurringTitle ? 4 : 10;
          if (Math.abs(page.pageNumber - expectedPdfPage) > maxAllowedDrift) {
            continue;
          }
        }

        const headings = pageHeadingsMap.get(page.pageNumber) || [];
        for (const h of headings) {
          const score = scoreTocToHeadingMatch(c.cleanTitle, h.title, c.level, h.level);
          if (score >= 0.85) {
            globalMatches.push({
              pageNumber: page.pageNumber,
              anchorId: h.anchorId,
              score,
              headingLevel: h.level,
            });
          }
        }
      }

      if (globalMatches.length > 0) {
        globalMatches.sort((a, b) => {
          // 1. Prefer significantly higher match score
          if (Math.abs(b.score - a.score) > 0.04) return b.score - a.score;
          // 2. If expectedPdfPage is known, prefer the match closest to expectedPdfPage
          if (expectedPdfPage !== undefined) {
            const distA = Math.abs(a.pageNumber - expectedPdfPage);
            const distB = Math.abs(b.pageNumber - expectedPdfPage);
            if (distA !== distB) return distA - distB;
          }
          // 3. For a top-level chapter/back-matter entry, prefer Level 1 headings over subheadings
          if (c.level === 1 && a.headingLevel !== b.headingLevel) {
            return a.headingLevel - b.headingLevel;
          }
          // 4. For back-matter generic titles (e.g. "উপসংহার") at the end of the TOC without printed page, prefer later chapter
          if (
            cProfile.isGenericRecurringTitle &&
            idx >= candidates.length - 2 &&
            candidates.length >= 3
          ) {
            return b.pageNumber - a.pageNumber;
          }
          return a.pageNumber - b.pageNumber;
        });

        const chosen = globalMatches[0];
        matchedPageNumber = chosen.pageNumber;
        matchedAnchorId = chosen.anchorId;
        resolutionEvidence = 'monotonic_heading_match';
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 2: Reliable Printed Page Number + Offset Mapping
    // (Includes smart handling for excluded target pages without falling back to Page 1)
    // -------------------------------------------------------------------------
    if (!matchedPageNumber && hasPrintedPage && expectedPdfPage !== undefined) {
      const exactPage =
        contentPages.find((p) => p.pageNumber === expectedPdfPage) ||
        (fallbackDirectPdfPage !== undefined
          ? contentPages.find((p) => p.pageNumber === fallbackDirectPdfPage)
          : undefined) ||
        (dominantOffset === 0
          ? contentPages.find((p) => p.pageNumber === c.printedPageNumber)
          : undefined);

      if (exactPage && exactPage.pageNumber >= minMonotonicPage) {
        matchedPageNumber = exactPage.pageNumber;
        resolutionEvidence = 'printed_page_offset_match';

        // Only attach a heading anchor on exactPage if that heading genuinely matches or is the sole compatible chapter opener
        const headings = pageHeadingsMap.get(exactPage.pageNumber) || [];
        const matchedH = headings
          .map((h) => ({
            h,
            score: scoreTocToHeadingMatch(c.cleanTitle, h.title, c.level, h.level),
          }))
          .filter((item) => item.score >= 0.65)
          .sort((a, b) => b.score - a.score)[0];

        if (matchedH) {
          matchedAnchorId = matchedH.h.anchorId;
        } else if (
          c.level === 1 &&
          headings.length === 1 &&
          headings[0].level === 1 &&
          !hasConflictingChapterNumbers(cProfile, buildHeadingMatchProfile(headings[0].title))
        ) {
          matchedAnchorId = headings[0].anchorId;
        }
      } else if (isExpectedPageWithinBook) {
        // Target page was excluded (e.g. blank/separator page) or shifted by 1-2 pages:
        // Inspect adjacent content pages in [expectedPdfPage, expectedPdfPage + 2] (or expectedPdfPage - 1)
        const upperLimit =
          nextExpectedPdfPage !== undefined
            ? Math.max(expectedPdfPage, nextExpectedPdfPage - 1)
            : expectedPdfPage + 3;

        const adjacentPages = contentPages.filter(
          (p) =>
            p.pageNumber >= Math.max(minMonotonicPage, expectedPdfPage - 1) &&
            p.pageNumber <= Math.min(upperLimit, expectedPdfPage + 3)
        );

        // Sort so pages >= expectedPdfPage come first (since content after an excluded page flows forward)
        adjacentPages.sort((a, b) => {
          const aForward = a.pageNumber >= expectedPdfPage ? 0 : 1;
          const bForward = b.pageNumber >= expectedPdfPage ? 0 : 1;
          if (aForward !== bForward) return aForward - bForward;
          return Math.abs(a.pageNumber - expectedPdfPage) - Math.abs(b.pageNumber - expectedPdfPage);
        });

        if (adjacentPages.length > 0) {
          const adjPage = adjacentPages[0];
          matchedPageNumber = adjPage.pageNumber;
          resolutionEvidence = 'adjacent_page_after_excluded_target';

          const headings = pageHeadingsMap.get(adjPage.pageNumber) || [];
          const matchedH = headings
            .map((h) => ({
              h,
              score: scoreTocToHeadingMatch(c.cleanTitle, h.title, c.level, h.level),
            }))
            .filter((item) => item.score >= 0.65)
            .sort((a, b) => b.score - a.score)[0];

          if (matchedH) {
            matchedAnchorId = matchedH.h.anchorId;
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 5: Unresolved Entry Handling (No Speculative Distant Jumps)
    // -------------------------------------------------------------------------
    let isUnresolved = false;
    if (!matchedPageNumber) {
      unresolvedCount++;
      isUnresolved = true;
      resolutionEvidence = 'unresolved_destination';

      // Keep monotonic continuity instead of jumping back to page 1 when later entries are unresolved
      if (hasPrintedPage && expectedPdfPage !== undefined) {
        const clampedTarget = Math.max(minMonotonicPage, Math.min(expectedPdfPage, maxContentPage));
        const nearestForward =
          contentPages.find((p) => p.pageNumber >= clampedTarget) ||
          contentPages[contentPages.length - 1] ||
          contentPages[0];
        matchedPageNumber = nearestForward ? nearestForward.pageNumber : 1;
      } else {
        matchedPageNumber = lastResolvedPageNumber || minContentPage;
      }
    } else {
      resolvedCount++;
      lastResolvedPageNumber = matchedPageNumber;
      if (c.level === 1) {
        lastResolvedL1PageNumber = matchedPageNumber;
      }
      lastResolvedLevel = c.level;

      // Update activeLocalOffset when a heading match confirms a local offset shift (e.g. after excluded pages)
      if (
        hasPrintedPage &&
        (resolutionEvidence === 'local_window_heading_match' ||
          resolutionEvidence === 'monotonic_heading_match')
      ) {
        const newOffset = matchedPageNumber - c.printedPageNumber!;
        if (newOffset >= -15 && newOffset <= 60) {
          activeLocalOffset = newOffset;
        }
      }
    }

    const filename = `page_${matchedPageNumber}.xhtml`;
    const targetHref = matchedAnchorId ? `${filename}#${matchedAnchorId}` : filename;
    const updatedEvidence = resolutionEvidence
      ? [...c.evidence, resolutionEvidence]
      : [...c.evidence];

    resolvedList.push({
      ...c,
      targetPageNumber: matchedPageNumber,
      anchorId: matchedAnchorId,
      targetHref,
      confidence: isUnresolved ? Math.min(c.confidence, 0.35) : c.confidence,
      evidence: updatedEvidence,
    });
  }

  return {
    resolvedCandidates: resolvedList,
    resolvedCount,
    unresolvedCount,
  };
}

/**
 * Non-destructively normalizes Bengali & multilingual Unicode sequences for comparison only.
 * Never mutates the display title stored in TOC or headings.
 */
export function normalizeBengaliUnicodeForMatch(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u09AF\u09BC/g, '\u09DF') // য + ় -> য়
    .replace(/\u09A1\u09BC/g, '\u09DC') // ড + ় -> ড়
    .replace(/\u09A2\u09BC/g, '\u09DD'); // ঢ + ় -> ঢ়
}

const BENGALI_ORDINAL_TO_NUMBER: Record<string, string> = {
  প্রথম: '1',
  দ্বিতীয়: '2',
  দ্বিতীয়: '2',
  তৃতীয়: '3',
  তৃতীয়: '3',
  চতুর্থ: '4',
  পঞ্চম: '5',
  ষষ্ঠ: '6',
  সপ্তম: '7',
  অষ্টম: '8',
  নবম: '9',
  দশম: '10',
  একাদশ: '11',
  দ্বাদশ: '12',
  ত্রয়োদশ: '13',
  ত্রয়োদশ: '13',
  চতুর্দশ: '14',
  পঞ্চদশ: '15',
  ষোড়শ: '16',
  ষোড়শ: '16',
  সপ্তদশ: '17',
  অষ্টাদশ: '18',
  ঊনবিংশ: '19',
  বিংশ: '20',
  এক: '1',
  দুই: '2',
  তিন: '3',
  চার: '4',
  পাঁচ: '5',
  ছয়: '6',
  ছয়: '6',
  সাত: '7',
  আট: '8',
  নয়: '9',
  নয়: '9',
  দশ: '10',
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  sixth: '6',
  seventh: '7',
  eighth: '8',
  ninth: '9',
  tenth: '10',
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

interface HeadingMatchProfile {
  rawNormalized: string;
  coreNormalized: string;
  outerListNumber?: string;
  chapterOrdinal?: string;
  subsectionNumber?: string;
  alphaMarker?: string;
  explicitNumbers: Set<string>;
  isStandaloneChapterLabel: boolean;
  isGenericRecurringTitle: boolean;
}

function toAsciiDigitsStr(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

export function buildHeadingMatchProfile(rawTitle: string): HeadingMatchProfile {
  const unicodeClean = normalizeBengaliUnicodeForMatch(rawTitle || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();

  const lower = unicodeClean.toLowerCase();
  const explicitNumbers = new Set<string>();
  let outerListNumber: string | undefined;
  let chapterOrdinal: string | undefined;
  let subsectionNumber: string | undefined;
  let alphaMarker: string | undefined;

  let working = lower;

  // 1. Check for multi-level numeric subsection prefix (e.g. "১.১", "১.১.১")
  const subsecMatch = working.match(/^([০-৯0-9]+(?:\.[০-৯0-9]+)+)(?=[\s:।.\-–—)\]]|$)\s*[:।.\-–—)\]]*\s*/);
  if (subsecMatch) {
    subsectionNumber = toAsciiDigitsStr(subsecMatch[1]);
    explicitNumbers.add(subsectionNumber);
    working = working.slice(subsecMatch[0].length).trim();
  } else {
    // 2. Check for Bengali alphabetical prefix: ক., (ক), ক)
    const alphaMatch = working.match(/^(?:[\(\[]([ক-হ])[\)\]]|([ক-হ])[\.\)\]])\s*[:\-–—]*\s*/);
    if (alphaMatch) {
      alphaMarker = alphaMatch[1] || alphaMatch[2];
      working = working.slice(alphaMatch[0].length).trim();
    } else {
      // 3. Check for leading outer list number: "১.", "2)", "১০ -"
      const outerNumMatch = working.match(/^([০-৯0-9]+)[\.\)\-–—:]+\s*/);
      if (outerNumMatch) {
        outerListNumber = toAsciiDigitsStr(outerNumMatch[1]);
        explicitNumbers.add(outerListNumber);
        working = working.slice(outerNumMatch[0].length).trim();
      }
    }
  }

  // 4. Check for explicit chapter/part ordinal prefix in working text:
  // e.g. "প্রথম অধ্যায়: বাবরের ভারত অভিযান", "অধ্যায় ১: সূচনা", "Chapter II: The Journey"
  const ordinalPrefixMatch = working.match(
    /^(?:(প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|ত্রয়োদশ|ত্রয়োদশ|চতুর্দশ|পঞ্চদশ|ষোড়শ|ষোড়শ|সপ্তদশ|অষ্টাদশ|ঊনবিংশ|বিংশ|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|ভাগ|অঙ্ক|দৃশ্য|chapter|part|book|volume|act|scene)|(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ|পর্ব|খণ্ড|ভাগ|অঙ্ক|দৃশ্য|chapter|part|book|volume|act|scene)\s+([০-৯0-9]+|প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|ছয়|সাত|আট|নয়|নয়|দশ|i|ii|iii|iv|v|vi|vii|viii|ix|x))(?=\s|$|[:।.\-–—)\]])\s*[:।.\-–—)\]]*\s*/i
  );

  let isStandaloneChapterLabel = false;
  if (ordinalPrefixMatch) {
    const rawToken = (ordinalPrefixMatch[1] || ordinalPrefixMatch[2] || '').toLowerCase();
    const mappedOrd = BENGALI_ORDINAL_TO_NUMBER[rawToken] || toAsciiDigitsStr(rawToken);
    if (mappedOrd) {
      chapterOrdinal = mappedOrd;
      explicitNumbers.add(mappedOrd);
    }
    const remainder = working.slice(ordinalPrefixMatch[0].length).trim();
    if (remainder.length >= 2) {
      working = remainder;
    } else {
      isStandaloneChapterLabel = true;
    }
  }

  const stripPunctAndSpace = (s: string) =>
    s
      .replace(/[#*_\-\–—:।.,()[\]{}'"`\/\\+=*&^%$#@~|;]/g, '')
      .replace(/\s+/g, '')
      .trim();

  const rawNormalized = stripPunctAndSpace(lower);
  const coreCandidate = stripPunctAndSpace(working);
  const coreNormalized = coreCandidate.length >= 2 ? coreCandidate : rawNormalized;

  const isGenericRecurringTitle =
    /^(?:ভূমিকা|সূচনা|প্রস্তাবনা|মুখবন্ধ|প্রাককথন|উপসংহার|পরিশিষ্ট|গ্রন্থপঞ্জি|তথ্যসূত্র|টীকা|নির্ঘণ্ট|সমাপ্তি|পরিচিতি|সারসংক্ষেপ|introduction|preface|foreword|conclusion|epilogue|appendix|bibliography|references|notes|index|summary)$/i.test(
      coreNormalized
    );

  return {
    rawNormalized,
    coreNormalized,
    outerListNumber,
    chapterOrdinal,
    subsectionNumber,
    alphaMarker,
    explicitNumbers,
    isStandaloneChapterLabel,
    isGenericRecurringTitle,
  };
}

export function hasConflictingChapterNumbers(
  tocProf: HeadingMatchProfile,
  hProf: HeadingMatchProfile
): boolean {
  if (tocProf.subsectionNumber && hProf.subsectionNumber) {
    return tocProf.subsectionNumber !== hProf.subsectionNumber;
  }
  if (tocProf.alphaMarker && hProf.alphaMarker) {
    return tocProf.alphaMarker !== hProf.alphaMarker;
  }
  if (tocProf.chapterOrdinal && hProf.chapterOrdinal) {
    // Allow match if heading uses outerListNumber (e.g. TOC "২. প্রথম অধ্যায়" vs Heading "# অধ্যায় ২")
    if (
      tocProf.chapterOrdinal !== hProf.chapterOrdinal &&
      (!tocProf.outerListNumber || !hProf.explicitNumbers.has(tocProf.outerListNumber))
    ) {
      return true;
    }
  }
  if (
    !tocProf.chapterOrdinal &&
    tocProf.outerListNumber &&
    hProf.chapterOrdinal &&
    tocProf.outerListNumber !== hProf.chapterOrdinal &&
    tocProf.coreNormalized !== hProf.coreNormalized
  ) {
    return true;
  }
  return false;
}

/**
 * Scores the similarity between a TOC entry title and a document heading (0.0 to 1.0).
 * Strictly blocks short substring collisions and conflicting chapter/subsection numbers.
 */
export function scoreTocToHeadingMatch(
  tocTitle: string,
  headingTitle: string,
  tocLevel: number = 1,
  headingLevel: number = 1
): number {
  if (!tocTitle || !headingTitle) return 0;

  const tocProf = buildHeadingMatchProfile(tocTitle);
  const hProf = buildHeadingMatchProfile(headingTitle);

  if (!tocProf.rawNormalized || !hProf.rawNormalized) return 0;

  // 1. Veto any explicit chapter, subsection, or alphabetical marker conflict
  if (hasConflictingChapterNumbers(tocProf, hProf)) {
    return 0;
  }

  // Slight level penalty when a Level-1 generic chapter (like "উপসংহার") compares against a Level-2+ subheading
  const levelPenalty =
    tocLevel === 1 && headingLevel > 1 && tocProf.isGenericRecurringTitle ? 0.12 : 0;

  // 2. Exact full normalized match
  if (tocProf.rawNormalized.length >= 2 && tocProf.rawNormalized === hProf.rawNormalized) {
    return Math.max(0.8, 1.0 - levelPenalty);
  }

  // 3. Exact core title match (e.g. "১. বাবরের ভারত অভিযান" vs "প্রথম অধ্যায়: বাবরের ভারত অভিযান")
  if (
    tocProf.coreNormalized.length >= 2 &&
    tocProf.coreNormalized === hProf.coreNormalized &&
    !tocProf.isStandaloneChapterLabel &&
    !hProf.isStandaloneChapterLabel
  ) {
    return Math.max(0.8, 0.96 - levelPenalty);
  }

  // 4. Standalone chapter number match (e.g. TOC "প্রথম অধ্যায়: সূচনা" vs Heading "# প্রথম অধ্যায়")
  if (
    (tocProf.isStandaloneChapterLabel || hProf.isStandaloneChapterLabel) &&
    tocProf.explicitNumbers.size > 0 &&
    hProf.explicitNumbers.size > 0
  ) {
    const sharesNumber = Array.from(tocProf.explicitNumbers).some((n) =>
      hProf.explicitNumbers.has(n)
    );
    if (sharesNumber) {
      return 0.82;
    }
  }

  // 5. Controlled long-phrase containment (NEVER allow short substring matches or generic title containment!)
  if (tocProf.isGenericRecurringTitle || hProf.isGenericRecurringTitle) {
    return 0;
  }

  const a = tocProf.coreNormalized;
  const b = hProf.coreNormalized;
  const shorterLen = Math.min(a.length, b.length);
  const longerLen = Math.max(a.length, b.length);

  if (shorterLen >= 6 && longerLen > 0 && (a.includes(b) || b.includes(a))) {
    const coverage = shorterLen / longerLen;
    if (coverage >= 0.58) {
      return Math.min(0.92, 0.76 + coverage * 0.16) - levelPenalty;
    }
  }

  return 0;
}

/**
 * Normalizes text for robust title matching (removes numbers, punctuation, extra spaces).
 */
function normalizeForMatch(str: string): string {
  if (!str) return '';
  return buildHeadingMatchProfile(str).coreNormalized;
}

/**
 * Stage 3: Strict Fallback Strategy.
 * Reconstructs a clean, hierarchical navigation structure from confirmed chapter and section headings
 * (including multi-line chapter titles, layoutBlocks typography, Bengali alphabetical sections, and numeric subsections)
 * when no original Table of Contents exists.
 */
export function buildFallbackNavigation(
  contentPages: PageItem[],
  lang: 'bn' | 'en' | 'ar' | 'hi' = 'bn'
): EpubTocItem[] {
  if (!contentPages || contentPages.length === 0) return [];

  const verifiedCandidates: TocCandidate[] = [];

  for (const page of contentPages) {
    if (!page.markdown) continue;

    // Never extract fallback TOC headings from ordinary categorized price/ingredient/catalog list pages
    if (isOrdinaryDataListPage(page.markdown)) {
      continue;
    }

    const extractedHeadings = extractHeadingsFromMarkdown(
      page.markdown,
      page.pageNumber,
      false,
      page.layoutBlocks
    );

    let l1AddedOnPage = false;

    for (const h of extractedHeadings) {
      const titleText = h.title.trim();
      if (
        !titleText ||
        titleText.length < 2 ||
        titleText.length > 90 ||
        isDataValueOrUnitLine(titleText, titleText) ||
        /(?:ইত্যাদি|প্রভৃতি|etc\.?)$/i.test(titleText) ||
        isAmbiguousOrCorruptedHeadingCandidate(titleText)
      ) {
        continue;
      }

      if (h.level === 1 && h.isConfirmedChapter !== false) {
        if (!l1AddedOnPage) {
          l1AddedOnPage = true;
          verifiedCandidates.push({
            title: titleText,
            cleanTitle: titleText,
            targetPageNumber: page.pageNumber,
            anchorId: h.anchorId,
            targetHref: `page_${page.pageNumber}.xhtml#${h.anchorId}`,
            level: 1,
            confidence: h.confidence ?? 0.9,
            source: 'fallback_heading',
            evidence: ['confirmed_chapter_heading'],
            rawLine: titleText,
            sourcePageNumber: page.pageNumber,
          });
        }
      } else if (h.level >= 2 && (h.confidence ?? 0.8) >= 0.8) {
        // Include structured section/subsection headings (##, ###, ####, ১.১, ১.১.১, ক., (ক), উপ-অধ্যায়)
        // Exclude low-confidence Signal-8 bold body sentences (confidence 0.72)
        verifiedCandidates.push({
          title: titleText,
          cleanTitle: titleText,
          targetPageNumber: page.pageNumber,
          anchorId: h.anchorId,
          targetHref: `page_${page.pageNumber}.xhtml#${h.anchorId}`,
          level: h.level,
          confidence: h.confidence ?? 0.85,
          source: 'fallback_heading',
          evidence: ['structured_section_heading'],
          rawLine: titleText,
          sourcePageNumber: page.pageNumber,
        });
      }
    }
  }

  // If even strict chapter detection yielded nothing, use minimal safe page landmark
  if (verifiedCandidates.length === 0) {
    const defaultTitle = lang === 'bn' ? 'মূল গ্রন্থ' : 'Main Content';
    const firstP = contentPages[0];
    return [
      {
        id: 'fallback-main-content',
        title: defaultTitle,
        level: 1,
        targetPageNumber: firstP ? firstP.pageNumber : 1,
        targetHref: `page_${firstP ? firstP.pageNumber : 1}.xhtml`,
        semanticType: 'chapter',
        originalHeadingText: defaultTitle,
        sourcePageReferences: [firstP ? firstP.pageNumber : 1],
        confidence: 0.5,
        reviewStatus: 'inferred',
        children: [],
      },
    ];
  }

  // Assemble verified headings into a hierarchical tree (preserving top-level fallback IDs for backward compatibility)
  const tree = assembleTocTree(verifiedCandidates);
  let fallbackIdx = 0;
  const assignFallbackIds = (nodes: EpubTocItem[]) => {
    for (const node of nodes) {
      fallbackIdx++;
      node.id = `fallback-toc-${fallbackIdx}`;
      node.reviewStatus = 'inferred';
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          child.parentId = node.id;
        }
        assignFallbackIds(node.children);
      }
    }
  };
  assignFallbackIds(tree);
  return tree;
}

/**
 * Assembles a list of resolved TocCandidates into a clean, properly nested EpubTocItem[] tree (up to 4 levels).
 * Preserves parts, chapters, sections, and subsections without inventing entries.
 */
export function assembleTocTree(candidates: TocCandidate[]): EpubTocItem[] {
  const tree: EpubTocItem[] = [];
  let currentL1: EpubTocItem | null = null;
  let currentL2: EpubTocItem | null = null;
  let currentL3: EpubTocItem | null = null;
  let itemCounter = 0;

  for (const c of candidates) {
    itemCounter++;
    const meta = classifyHeadingSemanticTypeAndLabel(c.cleanTitle, c.level);
    const pageNum = c.targetPageNumber || 1;
    const isUnresolved = Boolean(c.evidence && c.evidence.includes('unresolved_destination'));
    const node: EpubTocItem = {
      id: `toc-${itemCounter}`,
      title: c.cleanTitle,
      level: c.level,
      targetPageNumber: pageNum,
      targetHref: c.targetHref || `page_${pageNum}.xhtml`,
      anchorId: c.anchorId,
      rawLine: c.rawLine,
      semanticType: meta.semanticType,
      originalHeadingText: c.title || c.cleanTitle,
      explicitNumberLabel: meta.explicitNumberLabel,
      sourcePageReferences: Array.from(
        new Set(
          [c.sourcePageNumber, pageNum].filter((n): n is number => typeof n === 'number' && n > 0)
        )
      ),
      confidence: c.confidence,
      reviewStatus: isUnresolved
        ? 'unresolved'
        : c.source === 'fallback_heading'
        ? 'inferred'
        : 'confirmed',
      children: [],
    };

    if (c.level === 1) {
      tree.push(node);
      currentL1 = node;
      currentL2 = null;
      currentL3 = null;
    } else if (c.level === 2) {
      if (currentL1) {
        node.parentId = currentL1.id;
        currentL1.children.push(node);
      } else {
        tree.push(node);
        currentL1 = node;
      }
      currentL2 = node;
      currentL3 = null;
    } else if (c.level === 3) {
      if (currentL2) {
        node.parentId = currentL2.id;
        currentL2.children.push(node);
      } else if (currentL1) {
        node.parentId = currentL1.id;
        currentL1.children.push(node);
      } else {
        tree.push(node);
      }
      currentL3 = node;
    } else {
      // Level 4
      if (currentL3) {
        node.parentId = currentL3.id;
        currentL3.children.push(node);
      } else if (currentL2) {
        node.parentId = currentL2.id;
        currentL2.children.push(node);
      } else if (currentL1) {
        node.parentId = currentL1.id;
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

  // When falling back because no valid TOC entries were extracted, never exclude any page as a TOC page
  diagnostics.identifiedTocPages = [];

  return {
    tree: fallbackTree,
    diagnostics,
    tocPages: [],
    isFallback: true,
    totalEntries: fallbackTree.length,
  };
}

/**
 * Builds the single Canonical Document Outline representing the semantic structure of the book
 * (title page, front matter, parts, chapters, sections, subsections, back matter, and uncertain OCR heading diagnostics).
 */
export function buildCanonicalDocumentOutline(
  tocTree: EpubTocItem[],
  validPages: PageItem[],
  bookDetails?: BookDetails,
  language: 'bn' | 'en' | 'ar' | 'hi' = 'bn',
  tocResult?: TocExtractionResult
): CanonicalDocumentOutline {
  const flatEntries: EpubTocItem[] = [];
  const confirmedChapterPages = new Set<number>();

  const enrichAndFlatten = (nodes: EpubTocItem[], parentId?: string) => {
    for (const node of nodes) {
      if (!node.semanticType) {
        const meta = classifyHeadingSemanticTypeAndLabel(node.title, node.level);
        node.semanticType = meta.semanticType;
        if (!node.explicitNumberLabel && meta.explicitNumberLabel) {
          node.explicitNumberLabel = meta.explicitNumberLabel;
        }
      }
      if (!node.originalHeadingText) {
        node.originalHeadingText = node.title;
      }
      if (parentId && !node.parentId) {
        node.parentId = parentId;
      }
      if (!node.sourcePageReferences || node.sourcePageReferences.length === 0) {
        node.sourcePageReferences = [node.targetPageNumber];
      }
      if (node.confidence === undefined) {
        node.confidence = tocResult?.isFallback ? 0.85 : 0.95;
      }
      if (!node.reviewStatus) {
        node.reviewStatus = tocResult?.isFallback ? 'inferred' : 'confirmed';
      }

      if (
        node.level === 1 &&
        (node.semanticType === 'chapter' ||
          node.semanticType === 'part' ||
          node.semanticType === 'frontmatter' ||
          node.semanticType === 'backmatter' ||
          node.semanticType === 'title-page')
      ) {
        confirmedChapterPages.add(node.targetPageNumber);
      }

      flatEntries.push(node);
      if (node.children && node.children.length > 0) {
        enrichAndFlatten(node.children, node.id);
      }
    }
  };

  enrichAndFlatten(tocTree);

  // Also collect any confirmed Level 1 headings from content pages and record any uncertain/corrupted heading candidates
  const uncertainHeadings: UncertainHeadingDiagnostic[] = [];
  for (const page of validPages) {
    if (!page.markdown) continue;
    const pageHeadings = extractHeadingsFromMarkdown(
      page.markdown,
      page.pageNumber,
      false,
      page.layoutBlocks
    );
    for (const h of pageHeadings) {
      if (h.level === 1 && h.isConfirmedChapter !== false) {
        confirmedChapterPages.add(page.pageNumber);
      }
    }

    const lines = page.markdown.split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const looksLikeHeadingAttempt =
        /^#{1,4}\s+/.test(trimmed) ||
        /^\*\*[^*]+\*\*$/.test(trimmed) ||
        /^(?:<center>|\[center\]|<h[1-4]\b)/i.test(trimmed);
      if (looksLikeHeadingAttempt) {
        const cleaned = cleanHeadingText(trimmed.replace(/^#{1,6}\s+/, ''));
        if (cleaned && isAmbiguousOrCorruptedHeadingCandidate(cleaned)) {
          uncertainHeadings.push({
            pageNumber: page.pageNumber,
            text: trimmed,
            reason: 'corrupted_or_ambiguous_ocr_heading_candidate',
            confidence: 0.25,
          });
        }
      }
    }
  }

  const source: CanonicalDocumentOutline['source'] = tocResult?.diagnostics.outlineFound
    ? 'pdf_outline'
    : tocResult?.isFallback
    ? 'body_headings_fallback'
    : 'printed_toc';

  return {
    bookTitle: bookDetails?.title || (language === 'bn' ? 'বাংলা বই' : 'Ebook'),
    bookAuthor: bookDetails?.author || (language === 'bn' ? 'অজ্ঞাত লেখক' : 'Unknown Author'),
    language,
    source,
    entries: tocTree,
    flatEntries,
    confirmedChapterPageNumbers: Array.from(confirmedChapterPages).sort((a, b) => a - b),
    uncertainHeadings,
  };
}

