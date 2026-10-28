import JSZip from 'jszip';
import {
  BookDetails,
  PageItem,
  PageFigure,
  EpubTocItem,
  StructureConfig,
  PdfOutlineItem,
  TocDiagnostics,
  LayoutCleanupReport,
  DocumentSemanticSectionType,
  CanonicalDocumentOutline,
  PdfTextBlock,
} from '../types';
import {
  MULTILINGUAL_TOC_LABELS,
  isTableOfContentsLabel,
  isDataValueOrUnitLine,
  isOrdinaryDataListPage,
  evaluateTocPageClassification,
  TocPageClassificationResult,
  detectTocPages,
  parseTocLineCandidate,
  extractAuthoritativeTocTree,
  buildCanonicalDocumentOutline,
  scoreTocToHeadingMatch,
  buildHeadingMatchProfile,
  hasConflictingChapterNumbers,
} from './tocExtractor';
import {
  stripInvalidXmlChars,
  sanitizeXmlEntities,
  normalizeHtmlToXhtml,
  validateXmlString,
  buildCompleteXhtmlDocument,
  repairMalformedXhtml,
  validateEpubPackage,
  PackageValidationReport,
} from './xhtmlValidator';
import {
  correctBengaliMixedScriptText,
  validateAndCorrectBengaliOcr,
  sanitizePagesForExport,
} from './bengaliOcrPipeline';
import {
  reconstructMultiColumnFromGeometry,
  reconstructMultiColumnMarkdown,
  detectAndStripRunningHeadersFooters,
  evaluateParagraphContinuation,
  classifyCrossPageContinuity,
  isPoetryOrVerseBlock,
  isUnmarkedProsePoetryBlock,
  mapScoreToConfidenceLevel,
  analyzeBengaliBoundaryFragments,
  reconstructDocumentLayoutForEpub,
  remapTocTreeForConsolidatedPages,
  normalizeEpubLayoutXhtml,
  cleanExcessiveInlineStyles,
  validateEpubXhtmlLayout,
} from './epubLayoutPipeline';
import { isGenericFigurePlaceholderCaption } from './imageExtractor';

export {
  isGenericFigurePlaceholderCaption,
  stripInvalidXmlChars,
  sanitizeXmlEntities,
  normalizeHtmlToXhtml,
  validateXmlString,
  buildCompleteXhtmlDocument,
  repairMalformedXhtml,
  validateEpubPackage,
  correctBengaliMixedScriptText,
  validateAndCorrectBengaliOcr,
  sanitizePagesForExport,
  reconstructMultiColumnFromGeometry,
  reconstructMultiColumnMarkdown,
  detectAndStripRunningHeadersFooters,
  evaluateParagraphContinuation,
  classifyCrossPageContinuity,
  isPoetryOrVerseBlock,
  isUnmarkedProsePoetryBlock,
  mapScoreToConfidenceLevel,
  analyzeBengaliBoundaryFragments,
  reconstructDocumentLayoutForEpub,
  remapTocTreeForConsolidatedPages,
  normalizeEpubLayoutXhtml,
  cleanExcessiveInlineStyles,
  validateEpubXhtmlLayout,
  isTableOfContentsLabel,
  isDataValueOrUnitLine,
  isOrdinaryDataListPage,
  evaluateTocPageClassification,
};
export type { PackageValidationReport, TocPageClassificationResult };

/**
 * Escapes characters for XML / XHTML compatibility and strips invalid XML 1.0 control characters
 */
export function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return stripInvalidXmlChars(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Cleanly strips printed page numbers appearing on scanned PDF pages (header or footer).
 * If isTocPage is true, we preserve the lines since TOC entries contain chapter page numbers.
 */
export function stripPrintedPageNumbers(text: string, isTocPage: boolean = false): string {
  if (!text) return '';
  if (isTocPage) return text.trim();

  const lines = text.split('\n');
  const filtered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Check if line is only a printed page number (Bengali or English digits)
    const isPageNumOnly =
      /^[-—–~|\s\.\*]*[০-৯0-9]{1,4}[-—–~|\s\.\*।]*$/.test(trimmed) ||
      /^(?:পৃষ্ঠা|পেজ|page)\s*[:।\-–—~.]*\s*[০-৯0-9]{1,4}$/i.test(trimmed) ||
      /^[০-৯0-9]{1,4}\s*[:।\-–—~/]*\s*(?:পৃষ্ঠা|পেজ|page)$/i.test(trimmed);

    // If it's an isolated page number line anywhere, skip it
    if (isPageNumOnly) {
      continue;
    }

    // Running header or footer with explicit page label or pipe separator on top or bottom
    if (
      (i === 0 || i >= lines.length - 2) &&
      /^.*?(?:[\-–—|]\s*(?:পৃষ্ঠা|পেজ|page)\s*[০-৯0-9]{1,4}|\|\s*[০-৯0-9]{1,4})\s*$/i.test(trimmed)
    ) {
      continue;
    }

    filtered.push(raw);
  }

  return filtered.join('\n').trim();
}

/**
 * Converts Bengali digits (০-৯) or English digits (0-9) to a number
 */
export function parseBengaliOrEnglishNumber(str: string): number | null {
  if (!str) return null;
  const bengaliMap: Record<string, string> = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  };
  const normalized = str.replace(/[০-৯]/g, (d) => bengaliMap[d] || d);
  const match = normalized.match(/\d+/);
  if (!match) return null;
  const val = parseInt(match[0], 10);
  return isNaN(val) ? null : val;
}

/**
 * Converts an integer number to Bengali numeral string (e.g. 3 -> "৩")
 */
export function numberToBengaliDigits(num: number): string {
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, (d) => bengaliDigits[parseInt(d, 10)] || d);
}

/**
 * Automatically detects the primary language/script of the document
 */
export function detectDocumentLanguage(
  pages: PageItem[] = [],
  bookDetails?: BookDetails
): 'bn' | 'en' | 'ar' | 'hi' {
  const metaSample = `${bookDetails?.title || ''} ${bookDetails?.author || ''} ${bookDetails?.description || ''}`;
  if (/[\u0980-\u09FF]/.test(metaSample)) return 'bn';
  if (/[\u0600-\u06FF]/.test(metaSample)) return 'ar';
  if (/[\u0900-\u097F]/.test(metaSample)) return 'hi';

  let bengaliChars = 0;
  let arabicChars = 0;
  let devanagariChars = 0;
  let latinChars = 0;

  for (const p of pages.slice(0, 15)) {
    if (!p.markdown) continue;
    const text = p.markdown;
    bengaliChars += (text.match(/[\u0980-\u09FF]/g) || []).length;
    arabicChars += (text.match(/[\u0600-\u06FF]/g) || []).length;
    devanagariChars += (text.match(/[\u0900-\u097F]/g) || []).length;
    latinChars += (text.match(/[a-zA-Z]/g) || []).length;
  }

  if (bengaliChars > latinChars && bengaliChars > 40) return 'bn';
  if (arabicChars > latinChars && arabicChars > 40) return 'ar';
  if (devanagariChars > latinChars && devanagariChars > 40) return 'hi';
  return 'en';
}

/**
 * Returns language-appropriate Table of Contents title
 */
export function getTocTitleForLanguage(lang: 'bn' | 'en' | 'ar' | 'hi'): string {
  switch (lang) {
    case 'bn':
      return 'সূচিপত্র';
    case 'ar':
      return 'الفهرس';
    case 'hi':
      return 'विषय-सूची';
    case 'en':
    default:
      return 'Table of Contents';
  }
}

/**
 * Checks whether text appears to be or contain a Table of Contents
 * using conservative multi-signal classification.
 */
export function isTableOfContentsText(text: string): boolean {
  if (!text) return false;
  if (isOrdinaryDataListPage(text)) return false;

  const syntheticPage: PageItem = {
    pageNumber: 1,
    status: 'completed',
    thumbnailUrl: null,
    fullImageUrl: null,
    markdown: text,
    figures: [],
  };
  return evaluateTocPageClassification(syntheticPage, [], 0).isTocPage;
}

/**
 * Smart multi-signal detection for Table of Contents pages
 */
export function isLikelyTocPage(
  page: PageItem,
  allPages: PageItem[] = [],
  structureConfig?: StructureConfig
): boolean {
  if (!page) return false;
  if (page.status === 'excluded') return false;
  if (!page.markdown || !page.markdown.trim()) return false;
  if (isOrdinaryDataListPage(page.markdown)) return false;

  const pool = allPages && allPages.length > 0 ? allPages : [page];
  const detectedPages = detectTocPages(pool, structureConfig);
  if (detectedPages.includes(page.pageNumber)) {
    return true;
  }
  if (pool.length > 1) {
    return false;
  }

  return evaluateTocPageClassification(page, pool).isTocPage;
}


/**
 * Sanitizes and cleans heading text for presentation
 */
export function cleanHeadingText(text: string): string {
  if (!text) return '';
  const cleaned = correctBengaliMixedScriptText(stripInvalidXmlChars(text));
  return cleaned
    .replace(/^<center>(.*?)<\/center>$/i, '$1')
    .replace(/^\[center\](.*?)\[\/center\]$/i, '$1')
    .replace(/^->\s*(.*?)\s*<-$/, '$1')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^<strong>(.*?)<\/strong>$/i, '$1')
    .replace(/^__(.*?)__$/, '$1')
    .replace(/<[^>]+>/g, '') // remove HTML tags
    .replace(/[\.\s\-_–—]+(?:পৃষ্ঠা|পেজ|page)\s*[০-৯0-9]+$/i, '') // remove trailing page numbers
    .replace(/[\.\-_–—]+$/, '') // remove trailing dots or dashes
    .trim();
}

/**
 * Creates a safe, deterministic, valid XML/HTML anchor ID for a heading
 */
export function createHeadingAnchorId(
  pageNumber: number,
  headingIndex: number,
  headingText: string
): string {
  const clean = headingText
    .toLowerCase()
    .replace(/[\s\-_–—:,।.\?!\(\)\[\]{}'"`<>\/\\+=*&^%$#@~|;]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35);
  return `toc-h-p${pageNumber}-${headingIndex}${clean ? '-' + clean : ''}`;
}

export interface DetectedHeadingInfo {
  level: 1 | 2 | 3 | 4;
  title: string;
  anchorId: string;
  isCenter: boolean;
  rawMatched: string;
  semanticType?: DocumentSemanticSectionType;
  explicitNumberLabel?: string;
  confidence?: number;
  isConfirmedChapter?: boolean;
  isStandaloneChapterNumberLine?: boolean;
}

export interface HeadingDetectionContext {
  prevNonEmptyLine?: string;
  nextNonEmptyLine?: string;
  isAtPageTop?: boolean;
  layoutBlocks?: PdfTextBlock[];
}

/**
 * Checks whether a candidate heading text contains OCR corruption, unresolved mixed scripts,
 * or incomplete trailing clause markers that make it an ambiguous OCR fragment rather than a real heading.
 */
export function isAmbiguousOrCorruptedHeadingCandidate(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Reject lines with heavy symbol/punctuation noise
  if (/[?@#$%^&*~_=]{2,}/.test(trimmed)) return true;

  // Reject lines that contain no script letters at all (unless a short 1-3 digit standalone chapter number)
  if (
    !/[\u0980-\u09E5\u09F0-\u09FFa-zA-Z\u0600-\u06FF\u0900-\u0965]/.test(trimmed) &&
    !/^[০-৯0-9]{1,3}$/.test(trimmed)
  ) {
    return true;
  }

  // Reject lines where a Latin letter or non-Bengali Indic script character is embedded mid-word inside Bengali
  if (/[\u0980-\u09FF][a-zA-Z\u0900-\u097F\u0C00-\u0C7F]|(?:[a-zA-Z\u0900-\u097F\u0C00-\u0C7F])[\u0980-\u09FF]/.test(trimmed)) {
    return true;
  }

  // Reject fragments ending with a comma, semicolon, or coordinating conjunction (indicating a split sentence)
  if (/[,;]\s*$/.test(trimmed)) return true;
  if (/\s+(?:এবং|ও|কিন্তু|অথবা|বা|যে|যা|কারণ|যদি|বলে|করে|হয়ে|হয়ে)\s*$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Classifies the semantic role and extracts any explicit numbering label present in the heading text.
 * Never fabricates a number when none is present in the source.
 */
export function classifyHeadingSemanticTypeAndLabel(
  cleanText: string,
  level: 1 | 2 | 3 | 4
): {
  semanticType: DocumentSemanticSectionType;
  explicitNumberLabel?: string;
  isStandaloneChapterNumberLine: boolean;
} {
  const trimmed = cleanText.trim();

  // Front matter
  if (
    /^(?:Preface|Foreword|Introduction|Prologue|Dedication|Acknowledgments|Acknowledgements)\b/i.test(trimmed) ||
    /^(?:ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উৎসর্গ|লেখকের কথা|প্রকাশকের কথা|কৃতজ্ঞতা স্বীকার|গ্রন্থকারের নিবেদন|নিবেদন)(?=\s|$|[:।.\-–—])/i.test(
      trimmed
    )
  ) {
    return { semanticType: 'frontmatter', isStandaloneChapterNumberLine: false };
  }

  // Back matter
  if (
    /^(?:Epilogue|Conclusion|Afterword|Appendix(?:\s+[A-Z0-9]+)?|Appendices|Bibliography|References|Glossary|Index)\b/i.test(
      trimmed
    ) ||
    /^(?:উপসংহার|পরিশিষ্ট(?:\s+[ক-হ০-৯\d]+)?|নির্ঘণ্ট|গ্রন্থপঞ্জি|তথ্যসূত্র|টীকা|শব্দকোষ)(?=\s|$|[:।.\-–—])/i.test(trimmed)
  ) {
    return { semanticType: 'backmatter', isStandaloneChapterNumberLine: false };
  }

  // Part / Volume
  const partMatch =
    trimmed.match(
      /^((?:Part|Volume|Book|Act|Tome|Band)\s+(?:[IVXLCDM\d]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten))\b/i
    ) ||
    trimmed.match(
      /^((?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক)|(?:পর্ব|খণ্ড|ভাগ|অঙ্ক)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ)))(?=\s|$|[:।.\-–—])/i
    );
  if (partMatch) {
    const label = partMatch[1].trim();
    const remainder = trimmed.slice(partMatch[0].length).replace(/^[\s:।.\-–—]+/, '').trim();
    return {
      semanticType: 'part',
      explicitNumberLabel: label,
      isStandaloneChapterNumberLine: remainder.length === 0,
    };
  }

  // Chapter with explicit keyword (অধ্যায়, পরিচ্ছেদ, Chapter, etc.)
  const chapterMatch =
    trimmed.match(
      /^((?:Chapter|Chapitre|Kapitel)\s+(?:[IVXLCDM\d]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten))\b/i
    ) ||
    trimmed.match(
      /^((?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|ত্রয়োদশ|চতুর্দশ|পঞ্চদশ|ষোড়শ|সপ্তদশ|অষ্টাদশ|ঊনবিংশ|বিংশ|[০-৯\d]+)\s*(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ)|(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ)))(?=\s|$|[:।.\-–—])/i
    );
  if (chapterMatch) {
    const label = chapterMatch[1].trim();
    const remainder = trimmed.slice(chapterMatch[0].length).replace(/^[\s:।.\-–—]+/, '').trim();
    return {
      semanticType: 'chapter',
      explicitNumberLabel: label,
      isStandaloneChapterNumberLine: remainder.length === 0,
    };
  }

  // Multi-level numeric subsections (e.g. ১.১.১ or 1.1.1 -> subsection; ১.১ or 1.1 -> section)
  const subNum3Match = trimmed.match(/^([০-৯\d]+\.[০-৯\d]+\.[০-৯\d]+(?:\.[০-৯\d]+)?)\b/);
  if (subNum3Match) {
    return {
      semanticType: 'subsection',
      explicitNumberLabel: subNum3Match[1],
      isStandaloneChapterNumberLine: false,
    };
  }
  const subNum2Match = trimmed.match(/^([০-৯\d]+\.[০-৯\d]+)\b/);
  if (subNum2Match) {
    return {
      semanticType: 'section',
      explicitNumberLabel: subNum2Match[1],
      isStandaloneChapterNumberLine: false,
    };
  }

  // Bengali alphabetical section / subsection labels: ক., (ক), ক), [ক], ক —
  const bengaliAlphaMatch = trimmed.match(/^([\(\[]?[ক-হ][\)\]\.]|[ক-হ]\s*[—–:-])(?=\s)/);
  if (bengaliAlphaMatch) {
    return {
      semanticType: level >= 3 ? 'subsection' : 'section',
      explicitNumberLabel: bengaliAlphaMatch[1].trim(),
      isStandaloneChapterNumberLine: false,
    };
  }

  // Numbered Level-1 chapter (e.g. "১. সোনার তরী" or "১ : সূচনা")
  const leadingNumMatch = trimmed.match(/^([০-৯\d]+[\.\):])(?:\s+|$)/);
  if (leadingNumMatch && level === 1) {
    const label = leadingNumMatch[1].replace(/[:\.\)]$/, '').trim();
    const remainder = trimmed.slice(leadingNumMatch[0].length).trim();
    return {
      semanticType: 'chapter',
      explicitNumberLabel: label,
      isStandaloneChapterNumberLine: remainder.length === 0,
    };
  }

  return {
    semanticType: level === 1 ? 'chapter' : level === 2 ? 'section' : 'subsection',
    isStandaloneChapterNumberLine: false,
  };
}

/**
 * Checks if a candidate line at the top of a page is backed by larger typography in PDF layoutBlocks.
 */
function hasLargerTypographyInLayoutBlocks(text: string, layoutBlocks?: PdfTextBlock[]): boolean {
  if (!layoutBlocks || layoutBlocks.length < 2) return false;
  const sizes = layoutBlocks
    .map((b) => b.fontSize)
    .filter((s): s is number => typeof s === 'number' && s > 0)
    .sort((a, b) => a - b);
  if (sizes.length < 2) return false;

  const baselineSize = sizes[Math.floor((sizes.length - 1) / 2)];
  const cleanTarget = text.replace(/[#*_<>\[\]]/g, '').trim();
  if (!cleanTarget) return false;

  const matchingBlock = layoutBlocks.find(
    (b) => b.text && (b.text.includes(cleanTarget) || cleanTarget.includes(b.text.trim()))
  );
  if (matchingBlock && typeof matchingBlock.fontSize === 'number') {
    return matchingBlock.fontSize >= baselineSize * 1.22;
  }
  return false;
}

/**
 * Intelligent multi-signal detector that identifies genuine headings from a line of text.
 * Distinguishes genuine headings from captions, body text, quotes, and footers.
 */
export function detectHeadingFromLine(
  rawLine: string,
  pageNumber: number,
  headingCounter: number,
  hasPartsInDoc: boolean = false,
  context?: HeadingDetectionContext
): DetectedHeadingInfo | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // Signal 1: Explicit Markdown heading syntax (# , ## , ### , #### )
  if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
    let level: 1 | 2 | 3 | 4 = 1;
    let text = '';
    if (trimmed.startsWith('#### ')) {
      level = 4;
      text = trimmed.substring(5).trim();
    } else if (trimmed.startsWith('### ')) {
      level = 3;
      text = trimmed.substring(4).trim();
    } else if (trimmed.startsWith('## ')) {
      level = 2;
      text = trimmed.substring(3).trim();
    } else {
      level = 1;
      text = trimmed.substring(2).trim();
    }

    const isCenter = /^(<center>|\[center\]|->)/i.test(text) || text.includes('text-center');
    const cleanText = cleanHeadingText(text);
    if (!cleanText) return null;

    const isAmbiguous = isAmbiguousOrCorruptedHeadingCandidate(cleanText);
    if (isAmbiguous) return null;

    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, level);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level,
      title: cleanText,
      anchorId,
      isCenter,
      rawMatched: rawLine,
      semanticType: meta.semanticType,
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.95,
      isConfirmedChapter: level === 1,
      isStandaloneChapterNumberLine: meta.isStandaloneChapterNumberLine,
    };
  }

  // Signal 2: HTML heading tags (<h1> ... <h4>)
  const htmlMatch = trimmed.match(/^<h([1-4])(?:\s+[^>]*)?>(.*?)<\/h\1>$/i);
  if (htmlMatch) {
    const level = parseInt(htmlMatch[1], 10) as 1 | 2 | 3 | 4;
    const text = htmlMatch[2].trim();
    const isCenter = /text-center|align=["']center["']/i.test(rawLine);
    const cleanText = cleanHeadingText(text);
    if (!cleanText) return null;

    const isAmbiguous = isAmbiguousOrCorruptedHeadingCandidate(cleanText);
    if (isAmbiguous) return null;

    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, level);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level,
      title: cleanText,
      anchorId,
      isCenter,
      rawMatched: rawLine,
      semanticType: meta.semanticType,
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.95,
      isConfirmedChapter: level === 1,
      isStandaloneChapterNumberLine: meta.isStandaloneChapterNumberLine,
    };
  }

  // Negative filters: Non-heading elements
  if (
    trimmed.startsWith('>') ||
    trimmed.startsWith('- ') ||
    trimmed.startsWith('* ') ||
    trimmed.startsWith('+ ') ||
    trimmed.includes('[IMAGE_FIGURE') ||
    trimmed.startsWith('![') ||
    trimmed.startsWith('[^') ||
    /^[-=—–_*.]{3,}$/.test(trimmed) ||
    isDataValueOrUnitLine(trimmed)
  ) {
    return null;
  }

  // Unwrap bold or center wrapper to inspect the core content
  const unwrapped = trimmed
    .replace(/^<center>(.*?)<\/center>$/i, '$1')
    .replace(/^\[center\](.*?)\[\/center\]$/i, '$1')
    .replace(/^->\s*(.*?)\s*<-$/, '$1')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^<strong>(.*?)<\/strong>$/i, '$1')
    .replace(/^__(.*?)__$/, '$1')
    .trim();

  const isExplicitlyStyled =
    unwrapped !== trimmed ||
    /^(<center>|\[center\]|->)/i.test(trimmed) ||
    /^\*\*.*?\*\*$/.test(trimmed) ||
    /^<strong>.*?<\/strong>$/i.test(trimmed);

  // Length constraints: headings are concise, not entire paragraphs
  if (unwrapped.length > 120 || unwrapped.length < 2) return null;
  if (isAmbiguousOrCorruptedHeadingCandidate(unwrapped)) return null;

  // Signal 3: Major Part / Volume keywords (Bengali & English & Latin)
  const isPart =
    /^(?:Part|Volume|Book|Act|Tome|Band)\s+(?:[IVXLCDM\d]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b/i.test(unwrapped) ||
    /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|[০-৯\d]+)\s*(?:পর্ব|খণ্ড|ভাগ|অঙ্ক)|(?:পর্ব|খণ্ড|ভাগ|অঙ্ক)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ))\b/i.test(unwrapped);

  if (isPart) {
    const cleanText = cleanHeadingText(unwrapped);
    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, 1);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level: 1,
      title: cleanText,
      anchorId,
      isCenter: isExplicitlyStyled,
      rawMatched: rawLine,
      semanticType: 'part',
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.95,
      isConfirmedChapter: true,
      isStandaloneChapterNumberLine: meta.isStandaloneChapterNumberLine,
    };
  }

  // Signal 4: Chapter keywords (Bengali & English & Latin)
  const isChapter =
    /^(?:Chapter|Chapitre|Kapitel)\s+(?:[IVXLCDM\d]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b/i.test(unwrapped) ||
    /^(?:(?:প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|ত্রয়োদশ|চতুর্দশ|পঞ্চদশ|ষোড়শ|সপ্তদশ|অষ্টাদশ|ঊনবিংশ|বিংশ|[০-৯\d]+)\s*(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ)|(?:অধ্যায়|অধ্যায়|পরিচ্ছেদ)\s*(?:[০-৯\d]+|[IVXLCDM]+|প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ))(?=\s|$|[:।.\-–—])/i.test(unwrapped);

  if (isChapter) {
    const cleanText = cleanHeadingText(unwrapped);
    const lvl: 1 | 2 = hasPartsInDoc ? 2 : 1;
    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, lvl);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level: lvl,
      title: cleanText,
      anchorId,
      isCenter: isExplicitlyStyled,
      rawMatched: rawLine,
      semanticType: 'chapter',
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.95,
      isConfirmedChapter: true,
      isStandaloneChapterNumberLine: meta.isStandaloneChapterNumberLine,
    };
  }

  // Signal 5: Front matter & Back matter structural headings
  const isFrontBackMatter =
    /^(?:Preface|Foreword|Introduction|Prologue|Dedication|Acknowledgments|Acknowledgements|Epilogue|Conclusion|Afterword|Appendix(?:\s+[A-Z0-9]+)?|Appendices|Bibliography|References|Glossary|Index)\b/i.test(unwrapped) ||
    /^(?:ভূমিকা|মুখবন্ধ|প্রাককথন|প্রস্তাবনা|উৎসর্গ|লেখকের কথা|প্রকাশকের কথা|কৃতজ্ঞতা স্বীকার|গ্রন্থকারের নিবেদন|উপসংহার|পরিশিষ্ট(?:\s+[ক-হ০-৯\d]+)?|নির্ঘণ্ট|গ্রন্থপঞ্জি|তথ্যসূত্র|টীকা|শব্দকোষ)(?=\s|$|[:।.\-–—])/i.test(unwrapped);

  if (isFrontBackMatter) {
    if (unwrapped.length <= 60 || isExplicitlyStyled) {
      const cleanText = cleanHeadingText(unwrapped);
      const meta = classifyHeadingSemanticTypeAndLabel(cleanText, 1);
      const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
      return {
        level: 1,
        title: cleanText,
        anchorId,
        isCenter: isExplicitlyStyled,
        rawMatched: rawLine,
        semanticType: meta.semanticType,
        confidence: 0.92,
        isConfirmedChapter: true,
        isStandaloneChapterNumberLine: false,
      };
    }
  }

  // Signal 6A: Numbered hierarchy patterns: 1.1.1 or ১.১.১ (Level 3/4) vs 1.1 or ১.১ (Level 2/3)
  if (/^[০-৯\d]+\.[০-৯\d]+\.[০-৯\d]+(?:\s+.*)?$/.test(unwrapped)) {
    const cleanText = cleanHeadingText(unwrapped);
    const lvl: 3 | 4 = hasPartsInDoc ? 4 : 3;
    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, lvl);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level: lvl,
      title: cleanText,
      anchorId,
      isCenter: isExplicitlyStyled,
      rawMatched: rawLine,
      semanticType: 'subsection',
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.9,
      isConfirmedChapter: false,
    };
  }

  if (/^[০-৯\d]+\.[০-৯\d]+(?:\s+.*)?$/.test(unwrapped)) {
    const cleanText = cleanHeadingText(unwrapped);
    const lvl: 2 | 3 = hasPartsInDoc ? 3 : 2;
    const meta = classifyHeadingSemanticTypeAndLabel(cleanText, lvl);
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level: lvl,
      title: cleanText,
      anchorId,
      isCenter: isExplicitlyStyled,
      rawMatched: rawLine,
      semanticType: 'section',
      explicitNumberLabel: meta.explicitNumberLabel,
      confidence: 0.9,
      isConfirmedChapter: false,
    };
  }

  // Signal 6B: Bengali Alphabetical Section / Subsection Headings: ক. ..., (ক) ..., ক) ..., ক — ...
  const bengaliAlphaMatch = unwrapped.match(
    /^([\(\[]?[ক-হ][\)\]\.]|[ক-হ]\s*[—–:-])\s+([^\n]{2,65})$/
  );
  if (bengaliAlphaMatch) {
    const bodyPart = bengaliAlphaMatch[2].trim();
    const wordCount = bodyPart.split(/\s+/).length;
    const endsWithSentencePunct = /[।?!]$/.test(bodyPart);
    const prevIsAlphaListItem =
      context?.prevNonEmptyLine &&
      /^([\(\[]?[ক-হ][\)\]\.]|[ক-হ]\s*[—–:-])\s+/.test(context.prevNonEmptyLine.trim());
    const nextIsAlphaListItem =
      context?.nextNonEmptyLine &&
      /^([\(\[]?[ক-হ][\)\]\.]|[ক-হ]\s*[—–:-])\s+/.test(context.nextNonEmptyLine.trim());

    if (
      !endsWithSentencePunct &&
      wordCount <= 8 &&
      (isExplicitlyStyled || (!prevIsAlphaListItem && !nextIsAlphaListItem))
    ) {
      const cleanText = cleanHeadingText(unwrapped);
      const lvl: 2 | 3 = hasPartsInDoc ? 3 : 2;
      const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
      return {
        level: lvl,
        title: cleanText,
        anchorId,
        isCenter: isExplicitlyStyled,
        rawMatched: rawLine,
        semanticType: 'section',
        explicitNumberLabel: bengaliAlphaMatch[1].trim(),
        confidence: isExplicitlyStyled ? 0.9 : 0.82,
        isConfirmedChapter: false,
      };
    }
  }

  // Signal 7: Section / Scene keywords
  if (/^(?:Section|Scene|অনুচ্ছেদ|উপ-?অধ্যায়|উপ-?অধ্যায়|দৃশ্য)\s+[০-৯\dIVXLCDMক-হ]+/i.test(unwrapped)) {
    const cleanText = cleanHeadingText(unwrapped);
    const lvl: 2 | 3 = hasPartsInDoc ? 3 : 2;
    const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
    return {
      level: lvl,
      title: cleanText,
      anchorId,
      isCenter: isExplicitlyStyled,
      rawMatched: rawLine,
      semanticType: 'section',
      confidence: 0.88,
      isConfirmedChapter: false,
    };
  }

  // Signal 7B: Typography / Layout-Block Font-Size Confirmed Heading at Top of Page
  if (
    context?.isAtPageTop &&
    context?.layoutBlocks &&
    unwrapped.length <= 75 &&
    !/[।?!,;]$/.test(unwrapped) &&
    hasLargerTypographyInLayoutBlocks(unwrapped, context.layoutBlocks)
  ) {
    const cleanText = cleanHeadingText(unwrapped);
    if (cleanText.length >= 2 && !/^(চিত্র|ছবি|নোট|চিত্রাঙ্কন|Fig|Figure|Note|Source|উৎস)\b/i.test(cleanText)) {
      const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
      return {
        level: 1,
        title: cleanText,
        anchorId,
        isCenter: true,
        rawMatched: rawLine,
        semanticType: 'chapter',
        confidence: 0.88,
        isConfirmedChapter: true,
      };
    }
  }

  // Signal 8: Standalone bold line or centered line that is short and does NOT end with sentence terminator
  if (isExplicitlyStyled && unwrapped.length <= 65) {
    const endsWithTerminator = /[।\.\?!,;:—–-]$/.test(unwrapped);
    if (!endsWithTerminator) {
      const cleanText = cleanHeadingText(unwrapped);
      if (
        cleanText.length >= 3 &&
        !/^(চিত্র|ছবি|নোট|চিত্রাঙ্কন|Fig|Figure|Note|Source|উৎস)\b/i.test(cleanText) &&
        !isAmbiguousOrCorruptedHeadingCandidate(cleanText)
      ) {
        const anchorId = createHeadingAnchorId(pageNumber, headingCounter, cleanText);
        const isTopOfPageChapter = Boolean(context?.isAtPageTop);
        return {
          level: hasPartsInDoc ? 2 : 1,
          title: cleanText,
          anchorId,
          isCenter: isExplicitlyStyled,
          rawMatched: rawLine,
          semanticType: isTopOfPageChapter ? 'chapter' : 'section',
          confidence: isTopOfPageChapter ? 0.8 : 0.7,
          isConfirmedChapter: isTopOfPageChapter,
        };
      }
    }
  }

  return null;
}

export interface ParsedTocLineResult {
  title: string;
  pageNumber: number;
  level: 1 | 2 | 3 | 4;
}

/**
 * Parses an individual line from a printed Table of Contents page into title, target page number, and hierarchy level
 */
export function parseTocLineWithLevel(rawLine: string): ParsedTocLineResult | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // Ignore header lines, dividers, or ordinary data/unit/price lines
  if (isTableOfContentsLabel(trimmed)) return null;
  if (/^[-=—–_*.]{3,}$/.test(trimmed)) return null;
  if (/^(?:বিশেষ বিজ্ঞপ্তি|পরিশিষ্ট|বিজ্ঞপ্তি|পুনশ্চ)/i.test(trimmed) && !/[০-৯0-9]{1,4}\s*$/.test(trimmed)) return null;
  if (isDataValueOrUnitLine(trimmed)) return null;

  // Detect leading whitespace before trimming (for indentation levels)
  const leadingSpaces = rawLine.match(/^\s*/)?.[0]?.replace(/\t/g, '  ').length || 0;

  // Extract title and page number
  let parsed: { title: string; pageNumber: number } | null = null;

  // Pattern 1: Title followed by dots/dashes/spaces, optional "পৃষ্ঠা"/"page", followed by digit at the end
  const matchWithSeparator = trimmed.match(
    /^(?:[-*•\d\.\)]\s*)?(.+?)(?:[\.\s\-_–—~·•]{2,}|\s+(?:পৃষ্ঠা|পেজ|page)\s*|\s*[\-–—]\s*)(?:(?:পৃষ্ঠা|পেজ|page)\s*)?([০-৯0-9]+)\s*$/i
  );
  if (matchWithSeparator) {
    const rawTitle = matchWithSeparator[1].trim().replace(/^[-*•\s]+/, '');
    const rawPage = matchWithSeparator[2].trim();
    const pageNum = parseBengaliOrEnglishNumber(rawPage);
    if (pageNum !== null && rawTitle.length > 0) {
      parsed = { title: rawTitle, pageNumber: pageNum };
    }
  }

  // Pattern 2: Title with (পৃষ্ঠা X) or [page X] at the end
  if (!parsed) {
    const matchParentheses = trimmed.match(
      /^(?:[-*•]\s*)?(.+?)\s*[\(\[](?:(?:পৃষ্ঠা|পেজ|page)\s*)?([০-৯0-9]+)[\)\]]\s*$/i
    );
    if (matchParentheses) {
      const rawTitle = matchParentheses[1].trim().replace(/^[-*•\s]+/, '');
      const rawPage = matchParentheses[2].trim();
      const pageNum = parseBengaliOrEnglishNumber(rawPage);
      if (pageNum !== null && rawTitle.length > 0) {
        parsed = { title: rawTitle, pageNumber: pageNum };
      }
    }
  }

  // Pattern 3: Line ending with whitespace and digits (at least 2 characters before the number)
  if (!parsed) {
    const matchEndingNumber = trimmed.match(
      /^(?:[-*•]\s*)?(.{2,})\s+(?:(?:পৃষ্ঠা|পেজ|page)\s*)?([০-৯0-9]+)\s*$/i
    );
    if (matchEndingNumber) {
      const rawTitle = matchEndingNumber[1].trim().replace(/[\.\-_–—\s]+$/, '');
      const pageNum = parseBengaliOrEnglishNumber(matchEndingNumber[2]);
      if (pageNum !== null && rawTitle.length > 0) {
        parsed = { title: rawTitle, pageNumber: pageNum };
      }
    }
  }

  if (!parsed) return null;

  // Determine Level: 1 (Part / Main Chapter), 2 (Section), 3 (Subsection), 4 (Deep)
  let level: 1 | 2 | 3 | 4 = 1;

  // Check 1: 3-part numbering like "১.১.১" or "1.1.1" -> Level 3 or 4
  if (/^[০-৯0-9]+\.[০-৯0-9]+\.[০-৯0-9]+/i.test(trimmed)) {
    level = 3;
  }
  // Check 2: 2-part numbering like "১.১", "1.1" -> Level 2
  else if (/^[০-৯0-9]+\.[০-৯0-9]+/i.test(trimmed)) {
    level = 2;
  }
  // Check 3: Indentation: >= 4 spaces -> Level 3, >= 2 spaces -> Level 2
  else if (leadingSpaces >= 4) {
    level = 3;
  } else if (leadingSpaces >= 2) {
    level = 2;
  }
  // Check 4: Sub-bullets: (ক), (খ), ক., খ., (i), (ii), etc. -> Level 2
  else if (/^(?:[\(\[]?[ক-ঞa-zA-Z][\)\]\.]|[-*•])\s+/i.test(trimmed)) {
    level = 2;
  }
  // Check 5: Keywords indicating sub-chapter or section
  else if (/^(?:উপ-?অধ্যায়|উপ-?অধ্যায়|পরিচ্ছেদ|অনুচ্ছেদ|অংশ|Section|Subsection)\b/i.test(trimmed)) {
    level = 2;
  }

  return {
    title: parsed.title,
    pageNumber: parsed.pageNumber,
    level,
  };
}

/**
 * Backward compatibility: parses TOC line returning title & pageNumber
 */
export function parseTocLine(line: string): { title: string; pageNumber: number } | null {
  const res = parseTocLineWithLevel(line);
  return res ? { title: res.title, pageNumber: res.pageNumber } : null;
}

export interface ExtractedHeading {
  level: 1 | 2 | 3 | 4;
  title: string;
  anchorId: string;
  pageNumber: number;
  semanticType?: DocumentSemanticSectionType;
  explicitNumberLabel?: string;
  confidence?: number;
  isConfirmedChapter?: boolean;
}

/**
 * Checks if the line immediately following a standalone chapter-number line
 * (e.g. "প্রথম অধ্যায়" followed by "বাবরের ভারত অভিযান") is a genuine chapter title line
 * that should be paired with the chapter number header.
 */
export function extractPairedChapterSubtitle(nextLine: string | undefined): string | null {
  if (!nextLine) return null;
  const trimmed = nextLine.trim();
  if (!trimmed) return null;

  // Reject structural blocks, lists, quotes, tables, figures, anchors, or dividers
  if (
    trimmed.startsWith('- ') ||
    trimmed.startsWith('* ') ||
    trimmed.startsWith('> ') ||
    trimmed.startsWith('|') ||
    trimmed.startsWith('[^') ||
    trimmed.includes('[IMAGE_FIGURE:') ||
    trimmed.startsWith('![') ||
    trimmed.includes('epub-page-anchor') ||
    /^[-=—–_*.]{3,}$/.test(trimmed) ||
    /^[০-৯0-9]+[\.\)]\s+/.test(trimmed) ||
    /^(?:[\(\[]?[ক-হa-zA-Z][\)\]\.])\s+/.test(trimmed)
  ) {
    return null;
  }

  const hasExplicitMarkup =
    /^#{1,4}\s+/.test(trimmed) ||
    /^\*\*[^*]+\*\*$/.test(trimmed) ||
    /^(?:<center>|\[center\]|<h[1-4]\b)/i.test(trimmed);

  const cleaned = cleanHeadingText(
    trimmed
      .replace(/^#{1,6}\s+/, '')
      .replace(/^<(?:center|h[1-6])[^>]*>(.*?)<\/(?:center|h[1-6])>$/i, '$1')
      .replace(/^\[center\](.*?)\[\/center\]$/i, '$1')
  );

  if (!cleaned || cleaned.length < 2 || cleaned.length > 75) return null;
  if (isTableOfContentsLabel(cleaned) || isGenericFigurePlaceholderCaption(cleaned)) return null;
  if (isAmbiguousOrCorruptedHeadingCandidate(cleaned)) return null;

  // Do not pair if the second line is itself another standalone chapter/part number label
  if (
    /^(?:(?:প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ)\s+(?:অধ্যায়|অধ্যায়|পর্ব|খণ্ড)|(?:অধ্যায়|অধ্যায়|পর্ব|খণ্ড|Chapter|Part)\s*[০-৯0-9IVXLCDM]+)$/i.test(
      cleaned
    )
  ) {
    return null;
  }

  // Reject figure captions
  if (/^(?:চিত্র|ছবি|Figure|Fig\.)\s*[০-৯0-9:]/i.test(cleaned)) {
    return null;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > (hasExplicitMarkup ? 10 : 6)) {
    return null;
  }

  // Unmarked lines ending in prose sentence punctuation or containing finite narrative verbs are body paragraphs
  if (!hasExplicitMarkup) {
    if (/[।.?!,;—–-]$/.test(cleaned)) return null;
    if (/(?:করেন|করেছেন|হয়েছিল|হয়েছিল|বললেন|বলেছেন|ছিলেন|থাকে|যায়|যায়|আছে|হলো|হল)\b/.test(cleaned)) {
      return null;
    }
  }

  return cleaned;
}

const MAX_EXTRACT_HEADINGS_CACHE_SIZE = 600;
const extractHeadingsCache = new Map<string, ExtractedHeading[]>();

/**
 * Matches a consolidated page-boundary marker (<span id="page_N" class="epub-page-anchor"></span>)
 * in any attribute order or self-closing XML form.
 */
function parseConsolidatedPageAnchorLine(trimmedLine: string): number | null {
  if (!trimmedLine || !trimmedLine.includes('epub-page-anchor')) return null;
  const match =
    trimmedLine.match(
      /^<span\s+[^>]*\bid=["']page_(\d+)["'][^>]*\bclass=["'][^"']*epub-page-anchor[^"']*["'][^>]*>(?:<\/span>)?$/i
    ) ||
    trimmedLine.match(
      /^<span\s+[^>]*\bclass=["'][^"']*epub-page-anchor[^"']*["'][^>]*\bid=["']page_(\d+)["'][^>]*>(?:<\/span>)?$/i
    );
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extracts all genuine headings from a page (or consolidated multi-page markdown)
 * with stable page-aware anchor IDs, semantic types, and multi-signal context.
 * Pre-processing and per-page counter resets strictly match markdownToXhtml.
 */
export function extractHeadingsFromMarkdown(
  markdown: string,
  pageNumber: number,
  hasPartsInDoc: boolean = false,
  layoutBlocks?: PdfTextBlock[]
): ExtractedHeading[] {
  if (!markdown) return [];

  const layoutSig =
    layoutBlocks && layoutBlocks.length > 0
      ? layoutBlocks.map((b) => `${Math.round(b.fontSize || 0)}:${(b.text || '').slice(0, 12)}`).join('|')
      : '';
  const cacheKey = `${pageNumber}:${hasPartsInDoc ? 1 : 0}:${layoutSig}:${markdown}`;
  const cached = extractHeadingsCache.get(cacheKey);
  if (cached) return cached;

  // Apply the same mixed-script correction and printed page number stripping as markdownToXhtml
  const scriptValidated = correctBengaliMixedScriptText(markdown);
  const pageNumStripped = stripPrintedPageNumbers(scriptValidated, false);
  const cleanMarkdown = reconstructMultiColumnMarkdown(pageNumStripped).reorderedText;

  const lines = cleanMarkdown.split('\n');
  const headings: ExtractedHeading[] = [];
  let activePageNumber = pageNumber || 1;
  let headingCounter = 0;
  let seenContentLines = 0;
  let usedIdsOnActivePage = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 1. Track consolidated page-boundary anchor markers (<span id="page_N" class="epub-page-anchor"></span>)
    const boundaryPageNum = parseConsolidatedPageAnchorLine(trimmed);
    if (boundaryPageNum !== null) {
      activePageNumber = boundaryPageNum;
      headingCounter = 0;
      seenContentLines = 0;
      usedIdsOnActivePage = new Set<string>();
      continue;
    }

    // 2. Skip artificial page-break tags, alignment wrapper tags, dividers, and empty HTML tags without incrementing seenContentLines
    if (
      /^<(?:div|p|span|br)\s+[^>]*(?:page-break|break-after|break-before|pdf-page-break)[^>]*>(?:<\/(?:div|p|span)>)?$/i.test(
        trimmed
      ) ||
      /^<(?:center|div\s+align=["'](?:center|right)["']|div\s+class=["'][^"']*(?:text-center|text-right)[^"']*["'])>$/i.test(
        trimmed
      ) ||
      /^<\/(?:center|div)>$/i.test(trimmed) ||
      trimmed === '---' ||
      trimmed === '___' ||
      /^(\*\s*\*\s*\*|•••|•\s*•\s*•|—\s*—\s*—)$/.test(trimmed) ||
      /^<(p|div|span|strong|em|b|i)(?:\s+[^>]*?)?>(\s|&nbsp;|&#160;|<br\s*\/?>)*<\/\1>$/i.test(
        trimmed
      ) ||
      /^(?:<br\s*\/?>\s*)+$/i.test(trimmed)
    ) {
      continue;
    }

    // 3. Skip image/figure placeholders (and consume their immediately following caption line, matching markdownToXhtml)
    if (trimmed.includes('[IMAGE_FIGURE:') || /^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) {
      let lookaheadIdx = i + 1;
      if (lookaheadIdx < lines.length && !lines[lookaheadIdx].trim() && lookaheadIdx + 1 < lines.length) {
        lookaheadIdx++;
      }
      if (lookaheadIdx < lines.length) {
        const nextTrimmed = lines[lookaheadIdx].trim();
        if (
          nextTrimmed &&
          (isGenericFigurePlaceholderCaption(nextTrimmed) ||
            /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*(?:[০-৯0-9]+\s*[:.—–-]?\s*\S+|[:.—–-]\s*\S+)/i.test(
              nextTrimmed
            ))
        ) {
          i = lookaheadIdx;
        }
      }
      continue;
    }

    if (
      isGenericFigurePlaceholderCaption(trimmed) ||
      /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*(?:[০-৯0-9]+\s*[:.—–-]?\s*\S+|[:.—–-]\s*\S+)/i.test(
        trimmed
      )
    ) {
      continue;
    }

    let prevNonEmptyLine = '';
    for (let p = i - 1; p >= 0; p--) {
      const pTrim = lines[p].trim();
      if (pTrim && !pTrim.includes('epub-page-anchor')) {
        prevNonEmptyLine = pTrim;
        break;
      }
    }

    let nextNonEmptyLine = '';
    let nextNonEmptyIdx = -1;
    for (let n = i + 1; n < lines.length; n++) {
      if (lines[n].trim()) {
        nextNonEmptyLine = lines[n].trim();
        nextNonEmptyIdx = n;
        break;
      }
    }

    const activeLayoutBlocks = activePageNumber === pageNumber ? layoutBlocks : undefined;
    const detected = detectHeadingFromLine(
      line,
      activePageNumber,
      headingCounter + 1,
      hasPartsInDoc,
      {
        prevNonEmptyLine,
        nextNonEmptyLine,
        isAtPageTop: seenContentLines === 0,
        layoutBlocks: activeLayoutBlocks,
      }
    );

    if (detected) {
      headingCounter++;
      let finalTitle = detected.title;
      let explicitNumberLabel = detected.explicitNumberLabel;

      // Pair two-line chapter headers (e.g. "প্রথম অধ্যায়" + "বাবরের ভারত অভিযান")
      if (
        detected.isStandaloneChapterNumberLine &&
        nextNonEmptyIdx !== -1 &&
        nextNonEmptyIdx - i <= 2
      ) {
        const pairedSubtitle = extractPairedChapterSubtitle(nextNonEmptyLine);
        if (pairedSubtitle) {
          explicitNumberLabel = detected.title;
          finalTitle = `${detected.title}: ${pairedSubtitle}`;
          i = nextNonEmptyIdx; // Consume subtitle line so it is not extracted twice
        }
      }

      let uniqueAnchorId = detected.anchorId;
      if (usedIdsOnActivePage.has(uniqueAnchorId)) {
        let suffix = 2;
        while (usedIdsOnActivePage.has(`${uniqueAnchorId}-${suffix}`)) {
          suffix++;
        }
        uniqueAnchorId = `${uniqueAnchorId}-${suffix}`;
      }
      usedIdsOnActivePage.add(uniqueAnchorId);

      headings.push({
        level: detected.level,
        title: finalTitle,
        anchorId: uniqueAnchorId,
        pageNumber: activePageNumber,
        semanticType: detected.semanticType,
        explicitNumberLabel,
        confidence: detected.confidence,
        isConfirmedChapter: detected.isConfirmedChapter,
      });
      seenContentLines++;
    } else {
      seenContentLines++;
    }
  }

  if (extractHeadingsCache.size >= MAX_EXTRACT_HEADINGS_CACHE_SIZE) {
    const oldestKey = extractHeadingsCache.keys().next().value;
    if (oldestKey !== undefined) {
      extractHeadingsCache.delete(oldestKey);
    }
  }
  extractHeadingsCache.set(cacheKey, headings);

  return headings;
}

export interface TargetPageResolution {
  pageNumber: number;
  filename: string;
  anchorId?: string;
  targetHref: string;
}

/**
 * Resolves the target XHTML file name and anchor ID for a TOC entry
 */
export function resolveTargetPageAndAnchor(
  targetPageNum: number,
  title: string,
  allPages: PageItem[] = []
): TargetPageResolution {
  if (!allPages || allPages.length === 0) {
    return {
      pageNumber: targetPageNum,
      filename: `page_${targetPageNum}.xhtml`,
      targetHref: `page_${targetPageNum}.xhtml`,
    };
  }

  // 1. Direct match by exact pageNumber
  let matchedPage = allPages.find((p) => p.pageNumber === targetPageNum);

  // 2. Strong heading match across pages if direct pageNumber was not found
  if (!matchedPage && title && title.trim().length >= 2) {
    let bestPage: PageItem | undefined;
    let bestScore = 0;
    for (const p of allPages) {
      if (!p.markdown) continue;
      const headings = extractHeadingsFromMarkdown(
        p.markdown,
        p.pageNumber,
        false,
        p.layoutBlocks
      );
      for (const h of headings) {
        const s = scoreTocToHeadingMatch(title, h.title, 1, h.level);
        if (s >= 0.85 && s > bestScore) {
          bestScore = s;
          bestPage = p;
        }
      }
    }
    matchedPage = bestPage;
  }

  // 3. Fallback: Find closest valid page
  if (!matchedPage) {
    const sorted = [...allPages].sort(
      (a, b) => Math.abs(a.pageNumber - targetPageNum) - Math.abs(b.pageNumber - targetPageNum)
    );
    matchedPage = sorted[0];
  }

  const pageNum = matchedPage ? matchedPage.pageNumber : targetPageNum;
  const filename = `page_${pageNum}.xhtml`;

  // 4. Look for an exact or strong matching heading anchor on the target page
  let anchorId: string | undefined = undefined;
  if (matchedPage && title && title.trim().length >= 2) {
    const headings = extractHeadingsFromMarkdown(
      matchedPage.markdown,
      matchedPage.pageNumber,
      false,
      matchedPage.layoutBlocks
    );
    const bestHeading = headings
      .map((h) => ({
        h,
        score: scoreTocToHeadingMatch(title, h.title, 1, h.level),
      }))
      .filter((item) => item.score >= 0.72 && item.h.pageNumber === pageNum)
      .sort((a, b) => b.score - a.score)[0];

    if (bestHeading) {
      anchorId = bestHeading.h.anchorId;
    } else if (
      headings.length === 1 &&
      headings[0].level === 1 &&
      headings[0].pageNumber === pageNum &&
      !hasConflictingChapterNumbers(
        buildHeadingMatchProfile(title),
        buildHeadingMatchProfile(headings[0].title)
      )
    ) {
      // Single confirmed chapter heading on the target page with no number conflict
      anchorId = headings[0].anchorId;
    }
  }

  const targetHref = anchorId ? `${filename}#${anchorId}` : filename;

  return {
    pageNumber: pageNum,
    filename,
    anchorId,
    targetHref,
  };
}

/**
 * Backward-compatible helper returning just the target file or targetHref
 */
export function resolveTargetPageFile(
  targetPageNum: number,
  title: string,
  allPages: PageItem[] = []
): string {
  const res = resolveTargetPageAndAnchor(targetPageNum, title, allPages);
  return res.targetHref;
}

export interface ParsedTocItem {
  title: string;
  targetPageNumber: number;
  targetHref: string;
  rawLine: string;
}

/**
 * Parses all valid TOC entries from a Markdown text
 */
export function parseTocEntriesFromMarkdown(
  markdown: string,
  allPages: PageItem[] = []
): ParsedTocItem[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const items: ParsedTocItem[] = [];

  for (const line of lines) {
    const parsed = parseTocLineWithLevel(line);
    if (parsed) {
      const res = resolveTargetPageAndAnchor(parsed.pageNumber, parsed.title, allPages);
      items.push({
        title: parsed.title,
        targetPageNumber: parsed.pageNumber,
        targetHref: res.targetHref,
        rawLine: line,
      });
    }
  }

  return items;
}

/**
 * Recursively checks whether a heading title or anchor is already represented in a TOC subtree
 */
function isHeadingInSubtree(node: EpubTocItem, cleanSearchTitle: string, anchorId: string): boolean {
  if (node.anchorId && node.anchorId === anchorId) return true;
  const cleanNodeTitle = node.title.toLowerCase().replace(/^[০-৯0-9\.\s\-–—:]*/, '').trim();
  if (cleanNodeTitle.length >= 2 && cleanSearchTitle.length >= 2) {
    if (cleanNodeTitle === cleanSearchTitle || cleanNodeTitle.includes(cleanSearchTitle) || cleanSearchTitle.includes(cleanNodeTitle)) {
      return true;
    }
  }
  if (node.children && node.children.length > 0) {
    return node.children.some((child) => isHeadingInSubtree(child, cleanSearchTitle, anchorId));
  }
  return false;
}

/**
 * Augments top-level chapters in tree with any sub-headings (## or ###) discovered on content pages
 */
function augmentTreeWithPageSubheadings(tree: EpubTocItem[], validPages: PageItem[]): void {
  if (!tree || tree.length === 0 || !validPages || validPages.length === 0) return;

  for (let cIdx = 0; cIdx < tree.length; cIdx++) {
    const currentChapter = tree[cIdx];
    const nextChapter = tree[cIdx + 1];

    const startPage = currentChapter.targetPageNumber;
    const endPage = nextChapter ? nextChapter.targetPageNumber - 1 : 999999;

    // Discover pages in this chapter's range
    const chapterPages = validPages.filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage);

    for (const page of chapterPages) {
      const pageHeadings = extractHeadingsFromMarkdown(
        page.markdown,
        page.pageNumber,
        false,
        page.layoutBlocks
      );
      for (const h of pageHeadings) {
        // Skip Level 1 headings that match the chapter title itself
        if (h.level === 1) continue;

        const cleanHTitle = h.title.toLowerCase().replace(/^[০-৯0-9\.\s\-–—:]*/, '').trim();
        const alreadyExists = isHeadingInSubtree(currentChapter, cleanHTitle, h.anchorId);

        if (!alreadyExists) {
          const subNode: EpubTocItem = {
            id: `sub-${page.pageNumber}-${h.anchorId}`,
            title: h.title,
            level: (h.level as 1 | 2 | 3 | 4) || 2,
            targetPageNumber: page.pageNumber,
            targetHref: `page_${page.pageNumber}.xhtml#${h.anchorId}`,
            anchorId: h.anchorId,
            semanticType: h.semanticType,
            originalHeadingText: h.title,
            explicitNumberLabel: h.explicitNumberLabel,
            sourcePageReferences: [page.pageNumber],
            confidence: h.confidence ?? 0.85,
            reviewStatus: 'confirmed',
            children: [],
          };

          if (h.level === 2) {
            subNode.parentId = currentChapter.id;
            currentChapter.children.push(subNode);
          } else if (h.level === 3 || h.level === 4) {
            const lastL2 = currentChapter.children[currentChapter.children.length - 1];
            if (lastL2 && lastL2.level === 2) {
              subNode.parentId = lastL2.id;
              lastL2.children.push(subNode);
            } else {
              subNode.parentId = currentChapter.id;
              currentChapter.children.push(subNode);
            }
          }
        }
      }
    }
  }
}

/**
 * Builds a hierarchical document tree from flat parsed items without inventing fake chapters
 */
function assembleHierarchyTree(
  flatItems: Array<ParsedTocLineResult & { rawLine: string }>,
  validPages: PageItem[]
): EpubTocItem[] {
  const tree: EpubTocItem[] = [];
  let currentL1: EpubTocItem | null = null;
  let currentL2: EpubTocItem | null = null;
  let currentL3: EpubTocItem | null = null;
  let itemCounter = 0;

  for (const item of flatItems) {
    itemCounter++;
    const res = resolveTargetPageAndAnchor(item.pageNumber, item.title, validPages);
    const meta = classifyHeadingSemanticTypeAndLabel(item.title, item.level);
    const node: EpubTocItem = {
      id: `toc-${itemCounter}`,
      title: item.title,
      level: item.level,
      targetPageNumber: res.pageNumber,
      targetHref: res.targetHref,
      anchorId: res.anchorId,
      rawLine: item.rawLine,
      semanticType: meta.semanticType,
      originalHeadingText: item.title,
      explicitNumberLabel: meta.explicitNumberLabel,
      sourcePageReferences: [res.pageNumber],
      confidence: 0.92,
      reviewStatus: 'confirmed',
      children: [],
    };

    if (item.level === 1) {
      tree.push(node);
      currentL1 = node;
      currentL2 = null;
      currentL3 = null;
    } else if (item.level === 2) {
      if (currentL1) {
        node.parentId = currentL1.id;
        currentL1.children.push(node);
      } else {
        // If no parent L1 exists, keep it at top level rather than inventing an artificial parent
        tree.push(node);
        currentL1 = node;
      }
      currentL2 = node;
      currentL3 = null;
    } else if (item.level === 3) {
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
 * Builds a universal hierarchical tree directly from detected headings across all pages
 */
function buildTreeFromAllPageHeadings(
  validPages: PageItem[],
  lang: 'bn' | 'en' | 'ar' | 'hi' = 'bn'
): EpubTocItem[] {
  // 1. Gather all headings from all pages
  const allHeadings: Array<ExtractedHeading & { pageNumber: number }> = [];
  for (const page of validPages) {
    const pageHeadings = extractHeadingsFromMarkdown(
      page.markdown,
      page.pageNumber,
      false,
      page.layoutBlocks
    );
    for (const h of pageHeadings) {
      allHeadings.push({ ...h, pageNumber: page.pageNumber });
    }
  }

  // 2. Fallback: If absolutely no headings were found across all pages
  if (allHeadings.length === 0) {
    return validPages.map((page, idx) => {
      const pageLabel =
        lang === 'bn'
          ? `অধ্যায় ${numberToBengaliDigits(idx + 1)} (পৃষ্ঠা ${numberToBengaliDigits(page.pageNumber)})`
          : `Chapter ${idx + 1} (Page ${page.pageNumber})`;

      return {
        id: `toc-page-${page.pageNumber}`,
        title: pageLabel,
        level: 1,
        targetPageNumber: page.pageNumber,
        targetHref: `page_${page.pageNumber}.xhtml`,
        semanticType: 'chapter',
        originalHeadingText: pageLabel,
        sourcePageReferences: [page.pageNumber],
        confidence: 0.5,
        reviewStatus: 'inferred',
        children: [],
      };
    });
  }

  // 3. Determine if Part-level headings exist
  const hasParts = allHeadings.some((h) =>
    /^(?:Part|Volume|Book|Act|পর্ব|খণ্ড|ভাগ|অঙ্ক)\b/i.test(h.title)
  );

  const tree: EpubTocItem[] = [];
  let currentPart: EpubTocItem | null = null;
  let currentChapter: EpubTocItem | null = null;
  let currentSection: EpubTocItem | null = null;
  let itemCounter = 0;

  for (const h of allHeadings) {
    itemCounter++;
    const meta = classifyHeadingSemanticTypeAndLabel(h.title, h.level);
    const node: EpubTocItem = {
      id: `toc-h-${itemCounter}`,
      title: h.title,
      level: h.level,
      targetPageNumber: h.pageNumber,
      targetHref: `page_${h.pageNumber}.xhtml#${h.anchorId}`,
      anchorId: h.anchorId,
      semanticType: h.semanticType || meta.semanticType,
      originalHeadingText: h.title,
      explicitNumberLabel: h.explicitNumberLabel || meta.explicitNumberLabel,
      sourcePageReferences: [h.pageNumber],
      confidence: h.confidence ?? 0.88,
      reviewStatus: 'confirmed',
      children: [],
    };

    if (hasParts) {
      const isThisPart = /^(?:Part|Volume|Book|Act|পর্ব|খণ্ড|ভাগ|অঙ্ক)\b/i.test(h.title);
      if (isThisPart || h.level === 1) {
        node.level = 1;
        tree.push(node);
        currentPart = node;
        currentChapter = null;
        currentSection = null;
      } else if (h.level === 2) {
        if (currentPart) {
          node.parentId = currentPart.id;
          currentPart.children.push(node);
        } else {
          tree.push(node);
        }
        currentChapter = node;
        currentSection = null;
      } else if (h.level === 3) {
        if (currentChapter) {
          node.parentId = currentChapter.id;
          currentChapter.children.push(node);
        } else if (currentPart) {
          node.parentId = currentPart.id;
          currentPart.children.push(node);
        } else {
          tree.push(node);
        }
        currentSection = node;
      } else {
        // Level 4
        if (currentSection) {
          node.parentId = currentSection.id;
          currentSection.children.push(node);
        } else if (currentChapter) {
          node.parentId = currentChapter.id;
          currentChapter.children.push(node);
        } else {
          tree.push(node);
        }
      }
    } else {
      // No Parts in document: Chapters / Front Matter are Level 1
      if (h.level === 1) {
        tree.push(node);
        currentChapter = node;
        currentSection = null;
      } else if (h.level === 2) {
        if (currentChapter) {
          node.parentId = currentChapter.id;
          currentChapter.children.push(node);
        } else {
          // If section comes before any Level 1 heading, keep at top level
          node.level = 1;
          tree.push(node);
          currentChapter = node;
        }
        currentSection = node;
      } else {
        // Level 3 or 4
        if (currentSection) {
          node.parentId = currentSection.id;
          currentSection.children.push(node);
        } else if (currentChapter) {
          node.parentId = currentChapter.id;
          currentChapter.children.push(node);
        } else {
          tree.push(node);
        }
      }
    }
  }

  return tree;
}

/**
 * Builds an authoritative, strictly verified Table of Contents tree.
 * Respects the golden rule: Original TOC is the primary source of truth.
 * Never collects random headings or bold sentences from chapter body text!
 */
export function buildUniversalDocumentTree(
  validPages: PageItem[],
  tocPageOrPages?: PageItem | PageItem[],
  bookDetails?: BookDetails,
  structureConfig?: StructureConfig,
  pdfOutline?: PdfOutlineItem[]
): EpubTocItem[] {
  let effectiveConfig = structureConfig;
  if (tocPageOrPages) {
    const list = Array.isArray(tocPageOrPages) ? tocPageOrPages : [tocPageOrPages];
    const pageNums = list.map((p) => p.pageNumber).filter((n) => typeof n === 'number' && n > 0);
    if (pageNums.length > 0) {
      effectiveConfig = {
        bookType: structureConfig?.bookType || 'single',
        hasPrintedToc: true,
        includeTocInEpub: structureConfig?.includeTocInEpub ?? true,
        excludedPagesStr: structureConfig?.excludedPagesStr || '',
        excludedPagesList: structureConfig?.excludedPagesList || [],
        tocPagesStr: pageNums.join(', '),
      };
    }
  }

  const result = extractAuthoritativeTocTree(validPages, {
    pdfOutline,
    structureConfig: effectiveConfig,
    bookDetails,
  });

  return result.tree;
}


/**
 * Backward compatibility alias for buildUniversalDocumentTree
 */
export function buildComprehensiveTocTree(
  validPages: PageItem[],
  tocPageOrPages?: PageItem | PageItem[]
): EpubTocItem[] {
  return buildUniversalDocumentTree(validPages, tocPageOrPages);
}

/**
 * Calculates maximum depth of the TOC tree (1, 2, 3, or 4)
 */
export function calculateMaxDepth(nodes: EpubTocItem[]): number {
  if (!nodes || nodes.length === 0) return 1;
  let max = 1;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      max = Math.max(max, 1 + calculateMaxDepth(node.children));
    }
  }
  return Math.min(Math.max(max, 1), 4);
}

/**
 * Generates an elegant, publication-quality visual Table of Contents (toc.xhtml & contents.xhtml).
 * Features clean typographic hierarchy, responsive layout, and dark-mode compatibility.
 */
export function generateVisualTocHtml(
  tocTree: EpubTocItem[],
  bookTitle: string = '',
  author: string = '',
  lang: 'bn' | 'en' | 'ar' | 'hi' = 'bn'
): string {
  const tocHeading = getTocTitleForLanguage(lang);

  function renderList(nodes: EpubTocItem[], depth: number = 1): string {
    if (!nodes || nodes.length === 0) return '';
    const listClass = depth === 1 ? 'toc-list level-1' : `toc-sublist level-${depth}`;
    const items = nodes.map((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const subHtml = hasChildren ? `\n${renderList(node.children, depth + 1)}` : '';
      const levelClass = `level-${node.level}`;
      const semanticAttr = node.semanticType ? ` data-semantic-type="${escapeXml(node.semanticType)}"` : '';
      const safeAnchor = node.anchorId ? escapeXml(node.anchorId) : '';
      const anchorAttr = safeAnchor ? ` data-anchor="${safeAnchor}"` : '';
      const safeHref = escapeXml(node.targetHref);
      const safeTitle = escapeXml(node.title);

      return `
        <li class="toc-item ${levelClass}"${semanticAttr}>
          <a href="${safeHref}" class="toc-link" data-target-page="${node.targetPageNumber}"${anchorAttr}>
            <span class="toc-text">${safeTitle}</span>
          </a>${subHtml}
        </li>`;
    });

    return `<ul class="${listClass}">${items.join('\n')}</ul>`;
  }

  return `
    <div class="toc-wrapper">
      <header class="toc-header">
        <h1 class="toc-title">${escapeXml(tocHeading)}</h1>
        ${bookTitle ? `<p class="toc-book-title">${escapeXml(bookTitle)}</p>` : ''}
        ${author ? `<p class="toc-book-author">${escapeXml(author)}</p>` : ''}
        <div class="toc-ornament" aria-hidden="true"><span>* * *</span></div>
      </header>
      <nav class="toc-body" role="doc-toc" aria-label="${escapeXml(tocHeading)}">
        ${renderList(tocTree, 1)}
      </nav>
    </div>
  `;
}

/**
 * Converts Markdown content into clean, valid XHTML elements.
 * Emits matching anchor IDs for every detected heading and semantic chapter-opener blocks
 * for confirmed chapters, ensuring guaranteed valid internal navigation and publication typography.
 */
export function markdownToXhtml(
  markdown: string,
  figures: PageFigure[] = [],
  options: {
    isPreview?: boolean;
    pageNumber?: number;
    isTocPage?: boolean;
    allPages?: PageItem[];
    skipPostNormalize?: boolean;
    layoutBlocks?: PdfTextBlock[];
  } = {}
): string {
  if (!markdown) return '<p>...</p>';

  const isToc = options.isTocPage !== undefined ? Boolean(options.isTocPage) : isTableOfContentsText(markdown);

  // Ensure mixed-script OCR character errors (e.g. 'కిংবা' -> 'কিংবা') are corrected before XHTML conversion
  const scriptValidatedMarkdown = correctBengaliMixedScriptText(markdown);

  // Clean printed page numbers from the scan (preserving lines if this is a TOC page)
  const pageNumStripped = stripPrintedPageNumbers(scriptValidatedMarkdown, isToc);

  // Reconstruct multi-column reading order when side-by-side columns or HTML column wrappers are present
  const cleanMarkdown = isToc
    ? pageNumStripped
    : reconstructMultiColumnMarkdown(pageNumStripped).reorderedText;

  const lines = cleanMarkdown.split('\n');
  const xhtmlParts: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inBlockquote = false;
  let inTable = false;
  let inCenterBlock = false;
  let inRightBlock = false;
  let inTocList = false;
  let figureCounter = 0;
  let headingCounter = 0;
  let activePageNumber = options.pageNumber || 1;
  let hasEmittedChapterOpener = false;
  let seenContentLinesOnPage = 0;
  let usedIdsOnActivePage = new Set<string>();

  // Lookup layoutBlocks for the current page if available
  const resolvePageLayoutBlocks = (pageNum: number): PdfTextBlock[] | undefined => {
    if (options.layoutBlocks && pageNum === (options.pageNumber || 1)) {
      return options.layoutBlocks;
    }
    if (options.allPages && options.allPages.length > 0) {
      const foundPage = options.allPages.find((p) => p.pageNumber === pageNum);
      return foundPage?.layoutBlocks;
    }
    return undefined;
  };

  const closeOpenListsAndTables = () => {
    if (inList) {
      xhtmlParts.push('</ul>');
      inList = false;
    }
    if (inOrderedList) {
      xhtmlParts.push('</ol>');
      inOrderedList = false;
    }
    if (inBlockquote) {
      xhtmlParts.push('</blockquote>');
      inBlockquote = false;
    }
    if (inTable) {
      xhtmlParts.push('</tbody></table>');
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      closeOpenListsAndTables();
      if (inTocList) {
        xhtmlParts.push('</ul></nav></div>');
        inTocList = false;
      }
      continue;
    }

    // Track consolidated page-boundary anchor markers (<span id="page_N" class="epub-page-anchor"></span>)
    const boundaryPageNum = parseConsolidatedPageAnchorLine(trimmed);
    if (boundaryPageNum !== null) {
      closeOpenListsAndTables();
      activePageNumber = boundaryPageNum;
      headingCounter = 0;
      usedIdsOnActivePage = new Set<string>();
      seenContentLinesOnPage = 0;

      // If the opening paragraph of this continuation page was merged across the page boundary
      // prior to <span id="page_N">, the next block is no longer at the top of the source page.
      if (options.allPages && options.allPages.length > 0) {
        const sourcePage = options.allPages.find((p) => p.pageNumber === activePageNumber);
        if (sourcePage) {
          const srcCleaned = reconstructMultiColumnMarkdown(
            stripPrintedPageNumbers(correctBengaliMixedScriptText(sourcePage.markdown), false)
          ).reorderedText;
          const firstSrcLine = srcCleaned
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length > 0 && parseConsolidatedPageAnchorLine(l) === null);
          const nextConsolidatedLine = lines
            .slice(i + 1)
            .map((l) => l.trim())
            .find((l) => l.length > 0 && parseConsolidatedPageAnchorLine(l) === null);
          if (
            firstSrcLine &&
            nextConsolidatedLine &&
            firstSrcLine !== nextConsolidatedLine &&
            !nextConsolidatedLine.startsWith(firstSrcLine.slice(0, Math.min(16, firstSrcLine.length)))
          ) {
            seenContentLinesOnPage = 1;
          }
        }
      }

      xhtmlParts.push(`<span id="page_${activePageNumber}" class="epub-page-anchor"></span>`);
      continue;
    }

    // Skip artificial PDF page-break elements that interrupt continuous prose
    if (
      /^<(?:div|p|span|br)\s+[^>]*(?:page-break|break-after|break-before|pdf-page-break)[^>]*>(?:<\/(?:div|p|span)>)?$/i.test(
        trimmed
      )
    ) {
      continue;
    }

    // Interactive Table of Contents line handling (ONLY when page is an identified TOC page)
    const tocEntry = isToc ? parseTocLineWithLevel(rawLine) : null;
    if (tocEntry && isToc) {
      closeOpenListsAndTables();
      if (!inTocList) {
        xhtmlParts.push('<div class="toc-wrapper"><nav class="toc-body" role="doc-toc"><ul class="toc-list">');
        inTocList = true;
      }
      const targetRes = resolveTargetPageAndAnchor(tocEntry.pageNumber, tocEntry.title, options.allPages);
      const levelClass = `level-${tocEntry.level}`;
      const anchorAttr = targetRes.anchorId ? ` data-anchor="${targetRes.anchorId}"` : '';

      xhtmlParts.push(`
        <li class="toc-item ${levelClass}">
          <a href="${targetRes.targetHref}" class="toc-link" data-target-page="${targetRes.pageNumber}"${anchorAttr}>
            <span class="toc-text">${formatInline(tocEntry.title)}</span>
          </a>
        </li>
      `);
      continue;
    } else if (inTocList) {
      xhtmlParts.push('</ul></nav></div>');
      inTocList = false;
    }

    // Check if line is Table of Contents header (only when rendering a TOC page)
    if (isToc && isTableOfContentsLabel(trimmed)) {
      closeOpenListsAndTables();
      const cleanHeading = cleanHeadingText(trimmed.replace(/^#+\s*/, ''));
      xhtmlParts.push(`<h2 class="toc-title text-center font-bold">${formatInline(cleanHeading)}</h2>`);
      continue;
    }

    // Check if line is TOC divider
    if (isToc && /^[-=—–_*.]{3,}$/.test(trimmed)) {
      closeOpenListsAndTables();
      xhtmlParts.push('<hr class="toc-divider" />');
      continue;
    }

    // Multi-line alignment block wrappers
    if (/^<(center|div\s+align=["']center["']|div\s+class=["'][^"']*text-center[^"']*["'])>$/i.test(trimmed)) {
      closeOpenListsAndTables();
      inCenterBlock = true;
      continue;
    }
    if (/^<\/(center|div)>$/i.test(trimmed) && inCenterBlock) {
      inCenterBlock = false;
      continue;
    }
    if (/^<(div\s+align=["']right["']|div\s+class=["'][^"']*text-right[^"']*["'])>$/i.test(trimmed)) {
      closeOpenListsAndTables();
      inRightBlock = true;
      continue;
    }
    if (/^<\/div>$/i.test(trimmed) && inRightBlock) {
      inRightBlock = false;
      continue;
    }

    // Find surrounding non-empty lines for multi-signal heading detection
    let prevNonEmptyLine = '';
    for (let p = i - 1; p >= 0; p--) {
      if (lines[p].trim() && !lines[p].includes('epub-page-anchor')) {
        prevNonEmptyLine = lines[p].trim();
        break;
      }
    }
    let nextNonEmptyLine = '';
    let nextNonEmptyIdx = -1;
    for (let n = i + 1; n < lines.length; n++) {
      if (lines[n].trim()) {
        nextNonEmptyLine = lines[n].trim();
        nextNonEmptyIdx = n;
        break;
      }
    }

    // Intelligent Heading Detection with matching XML anchor IDs and semantic Chapter Openers
    const detectedHeading = detectHeadingFromLine(rawLine, activePageNumber, headingCounter + 1, false, {
      prevNonEmptyLine,
      nextNonEmptyLine,
      isAtPageTop: seenContentLinesOnPage === 0,
      layoutBlocks: resolvePageLayoutBlocks(activePageNumber),
    });
    if (detectedHeading) {
      headingCounter++;
      seenContentLinesOnPage++;
      closeOpenListsAndTables();
      if (inTocList) { xhtmlParts.push('</ul></nav></div>'); inTocList = false; }

      let uniqueAnchorId = detectedHeading.anchorId;
      if (usedIdsOnActivePage.has(uniqueAnchorId)) {
        let suffix = 2;
        while (usedIdsOnActivePage.has(`${uniqueAnchorId}-${suffix}`)) {
          suffix++;
        }
        uniqueAnchorId = `${uniqueAnchorId}-${suffix}`;
      }
      usedIdsOnActivePage.add(uniqueAnchorId);

      // Pair two-line chapter headers (e.g. "প্রথম অধ্যায়" + "বাবরের ভারত অভিযান") consistently with extractHeadingsFromMarkdown
      let pairedSubtitle: string | null = null;
      if (
        !isToc &&
        detectedHeading.isStandaloneChapterNumberLine &&
        nextNonEmptyIdx !== -1 &&
        nextNonEmptyIdx - i <= 2
      ) {
        pairedSubtitle = extractPairedChapterSubtitle(nextNonEmptyLine);
      }

      // Emit a semantic Chapter Opener for the primary confirmed Level-1 chapter/part/front-matter/back-matter heading
      if (
        !isToc &&
        !hasEmittedChapterOpener &&
        detectedHeading.level === 1 &&
        detectedHeading.isConfirmedChapter !== false
      ) {
        hasEmittedChapterOpener = true;
        if (pairedSubtitle) {
          i = nextNonEmptyIdx; // Consume the paired subtitle line
          xhtmlParts.push(
            `<header class="chapter-opener" epub:type="header">\n  <p class="chapter-number-label text-center">${formatInline(detectedHeading.title)}</p>\n  <h1 id="${uniqueAnchorId}" class="chapter-title text-center">${formatInline(pairedSubtitle)}</h1>\n  <hr class="chapter-opener-divider" />\n</header>`
          );
        } else {
          xhtmlParts.push(
            `<header class="chapter-opener" epub:type="header">\n  <h1 id="${uniqueAnchorId}" class="chapter-title text-center">${formatInline(detectedHeading.title)}</h1>\n  <hr class="chapter-opener-divider" />\n</header>`
          );
        }
        continue;
      }

      let renderedHeadingTitle = detectedHeading.title;
      if (pairedSubtitle) {
        i = nextNonEmptyIdx; // Keep headingCounter synchronized with extractHeadingsFromMarkdown
        renderedHeadingTitle = `${detectedHeading.title}: ${pairedSubtitle}`;
      }

      const tag = `h${detectedHeading.level}`;
      const semanticHeadingClass =
        detectedHeading.level === 1
          ? 'chapter-title'
          : detectedHeading.level === 2
          ? 'section-heading'
          : 'subsection-heading';
      const classes = [
        semanticHeadingClass,
        detectedHeading.isCenter || inCenterBlock ? 'text-center' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const classAttr = classes ? ` class="${classes}"` : '';
      xhtmlParts.push(`<${tag} id="${uniqueAnchorId}"${classAttr}>${formatInline(renderedHeadingTitle)}</${tag}>`);
      continue;
    }

    // Horizontal Rule or Centered Section Divider Ornaments (* * *, ***, • • •)
    if (trimmed === '---' || trimmed === '___') {
      closeOpenListsAndTables();
      xhtmlParts.push('<hr />');
      continue;
    }
    if (/^(\*\s*\*\s*\*|•••|•\s*•\s*•|—\s*—\s*—)$/.test(trimmed)) {
      closeOpenListsAndTables();
      xhtmlParts.push('<p class="section-divider text-center">* * *</p>');
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      seenContentLinesOnPage++;
      if (inList) { xhtmlParts.push('</ul>'); inList = false; }
      if (inOrderedList) { xhtmlParts.push('</ol>'); inOrderedList = false; }
      if (inTable) { xhtmlParts.push('</tbody></table>'); inTable = false; }
      if (!inBlockquote) {
        xhtmlParts.push('<blockquote class="bengali-quote">');
        inBlockquote = true;
      }
      xhtmlParts.push(`<p class="quote-line">${formatInline(trimmed.substring(2))}</p>`);
      continue;
    } else if (inBlockquote) {
      xhtmlParts.push('</blockquote>');
      inBlockquote = false;
    }

    // Ordered lists (1. or ১. or 1) or ১))
    const orderedListMatch = trimmed.match(/^([০-৯0-9]+)[\.\)]\s+(.+)$/);
    if (orderedListMatch) {
      seenContentLinesOnPage++;
      if (inList) { xhtmlParts.push('</ul>'); inList = false; }
      if (inBlockquote) { xhtmlParts.push('</blockquote>'); inBlockquote = false; }
      if (inTable) { xhtmlParts.push('</tbody></table>'); inTable = false; }
      if (!inOrderedList) {
        xhtmlParts.push('<ol>');
        inOrderedList = true;
      }
      xhtmlParts.push(`<li>${formatInline(orderedListMatch[2])}</li>`);
      continue;
    } else if (inOrderedList) {
      xhtmlParts.push('</ol>');
      inOrderedList = false;
    }

    // Markdown tables: | cell | cell |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      seenContentLinesOnPage++;
      if (inList) { xhtmlParts.push('</ul>'); inList = false; }
      if (inOrderedList) { xhtmlParts.push('</ol>'); inOrderedList = false; }
      if (inBlockquote) { xhtmlParts.push('</blockquote>'); inBlockquote = false; }

      if (!inTable) {
        xhtmlParts.push('<table class="epub-table"><tbody>');
        inTable = true;
      }

      // Skip separator rows: |---|---|
      if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) {
        const cells = trimmed
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        const cellTags = cells.map((c) => `<td>${formatInline(c)}</td>`).join('');
        xhtmlParts.push(`<tr>${cellTags}</tr>`);
      }
      continue;
    } else if (inTable) {
      xhtmlParts.push('</tbody></table>');
      inTable = false;
    }

    // Bulleted lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      seenContentLinesOnPage++;
      if (inOrderedList) { xhtmlParts.push('</ol>'); inOrderedList = false; }
      if (!inList) {
        xhtmlParts.push('<ul>');
        inList = true;
      }
      xhtmlParts.push(`<li>${formatInline(trimmed.substring(2))}</li>`);
      continue;
    } else if (inList) {
      xhtmlParts.push('</ul>');
      inList = false;
    }

    // Footnote
    if (trimmed.startsWith('[^') && trimmed.includes(']:')) {
      seenContentLinesOnPage++;
      xhtmlParts.push(`<p class="footnote"><em>${formatInline(trimmed)}</em></p>`);
      continue;
    }

    // Figure tag replacement: [IMAGE_FIGURE: ...]
    if (trimmed.includes('[IMAGE_FIGURE:')) {
      const currentFig = figures[figureCounter] || figures[0];
      figureCounter++;

      let figAlign: 'left' | 'center' | 'right' = currentFig?.align || 'left';
      const alignMatch = trimmed.match(/align["']?\s*:\s*["'](left|center|right)["']/i);
      if (alignMatch) {
        figAlign = alignMatch[1].toLowerCase() as any;
      } else if (currentFig?.left !== undefined) {
        const l = currentFig.left;
        const w = currentFig.width || 50;
        if (l < 25 && w < 60) figAlign = 'left';
        else if (l + w / 2 > 65 && w < 60) figAlign = 'right';
        else if (w >= 65 || (l >= 25 && l <= 45)) figAlign = 'center';
        else figAlign = 'left';
      }

      const figContainerClass =
        figAlign === 'left'
          ? 'book-figure fig-left text-left my-4'
          : figAlign === 'right'
          ? 'book-figure fig-right text-right my-4'
          : 'book-figure fig-center text-center my-4';

      const imgAlignClass =
        figAlign === 'left' ? 'mr-auto block' : figAlign === 'right' ? 'ml-auto block' : 'mx-auto block';

      const figDataStr = currentFig?.imageUrl || currentFig?.dataUrl || '';
      const isPng = figDataStr.startsWith('data:image/png') || currentFig?.mimeType === 'image/png';
      const figExt = isPng ? 'png' : 'jpg';

      const imgSrc = options.isPreview
        ? figDataStr
        : (options.pageNumber ? `figures/page_${options.pageNumber}_fig_${figureCounter}.${figExt}` : '');

      // Check for optional genuine figure caption (from currentFig.caption or immediately following caption line)
      // Automatically generated generic placeholders like "চিত্র" are strictly excluded.
      let captionText = currentFig?.caption?.trim() || '';
      if (isGenericFigurePlaceholderCaption(captionText)) {
        captionText = '';
      }

      let lookaheadIdx = i + 1;
      if (lookaheadIdx < lines.length && !lines[lookaheadIdx].trim() && lookaheadIdx + 1 < lines.length) {
        lookaheadIdx++;
      }
      if (lookaheadIdx < lines.length) {
        const nextTrimmed = lines[lookaheadIdx].trim();
        if (nextTrimmed && isGenericFigurePlaceholderCaption(nextTrimmed)) {
          i = lookaheadIdx; // consume and discard standalone generic placeholder line (e.g. "চিত্র")
        } else if (
          !captionText &&
          /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*(?:[০-৯0-9]+\s*[:.—–-]?\s*\S+|[:.—–-]\s*\S+)/i.test(
            nextTrimmed
          )
        ) {
          captionText = nextTrimmed.replace(/^(?:\*|_)+|(?:\*|_)+$/g, '').trim();
          i = lookaheadIdx; // consume genuine caption line into <figcaption>
        }
      }

      const figcaptionHtml = captionText
        ? `\n            <figcaption class="figure-caption">${formatInline(captionText)}</figcaption>`
        : '';

      if (imgSrc) {
        xhtmlParts.push(`
          <figure class="${figContainerClass}">
            <img src="${imgSrc}" alt="${escapeXml(captionText)}" class="book-img ${imgAlignClass} max-h-80 max-w-full object-contain my-2" />${figcaptionHtml}
          </figure>
        `);
      } else {
        xhtmlParts.push(`
          <figure class="${figContainerClass}">
            <div class="figure-frame py-6 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 text-xs inline-block px-8"></div>${figcaptionHtml}
          </figure>
        `);
      }
      continue;
    }

    // Markdown image syntax: ![alt](src)
    const mdImgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (mdImgMatch) {
      const rawAlt = (mdImgMatch[1] || '').trim();
      const alt = isGenericFigurePlaceholderCaption(rawAlt) ? '' : rawAlt;
      let src = mdImgMatch[2];
      if (options.isPreview && !src.startsWith('data:') && !src.startsWith('http')) {
        const found = figures.find((f) => (alt && f.caption === alt) || f.imageUrl);
        if (found && (found.imageUrl || found.dataUrl)) {
          src = found.imageUrl || found.dataUrl || src;
        }
      }

      let captionText = '';
      let lookaheadIdx = i + 1;
      if (lookaheadIdx < lines.length && !lines[lookaheadIdx].trim() && lookaheadIdx + 1 < lines.length) {
        lookaheadIdx++;
      }
      if (lookaheadIdx < lines.length) {
        const nextTrimmed = lines[lookaheadIdx].trim();
        if (nextTrimmed && isGenericFigurePlaceholderCaption(nextTrimmed)) {
          i = lookaheadIdx;
        } else if (
          /^(?:\*|_)?(?:চিত্র|ছবি|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|Figure|Fig\.|Photo|Plate)\s*(?:[০-৯0-9]+\s*[:.—–-]?\s*\S+|[:.—–-]\s*\S+)/i.test(
            nextTrimmed
          )
        ) {
          captionText = nextTrimmed.replace(/^(?:\*|_)+|(?:\*|_)+$/g, '').trim();
          i = lookaheadIdx;
        }
      }
      const figcaptionHtml = captionText
        ? `\n          <figcaption class="figure-caption">${formatInline(captionText)}</figcaption>`
        : '';

      xhtmlParts.push(`
        <figure class="book-figure fig-left text-left my-4">
          <img src="${src}" alt="${escapeXml(alt || captionText)}" class="book-img mr-auto max-h-80 max-w-full object-contain my-2" />${figcaptionHtml}
        </figure>
      `);
      continue;
    }

    // Single-line Center Align: <center>...</center>, [center]...[/center], -> ... <-
    const singleCenterMatch = trimmed.match(/^(?:<center>|\[center\]|->\s*)(.*?)(?:<\/center>|\[\/center\]|\s*<-)$/i);
    if (singleCenterMatch) {
      const innerText = singleCenterMatch[1].trim();
      if (innerText) {
        seenContentLinesOnPage++;
        xhtmlParts.push(`<p class="text-center">${formatInline(innerText)}</p>`);
      }
      continue;
    }

    // Single-line Right Align: [right]...[/right]
    const singleRightMatch = trimmed.match(/^\[right\](.*?)\[\/right\]$/i);
    if (singleRightMatch) {
      const innerText = singleRightMatch[1].trim();
      if (innerText) {
        seenContentLinesOnPage++;
        xhtmlParts.push(`<p class="text-right">${formatInline(innerText)}</p>`);
      }
      continue;
    }

    // Skip lines that consist solely of empty HTML tags (<p></p>, <div></div>, <span>  </span>) or standalone <br/> tags
    if (
      /^<(p|div|span|strong|em|b|i)(?:\s+[^>]*?)?>(\s|&nbsp;|&#160;|<br\s*\/?>)*<\/\1>$/i.test(trimmed) ||
      /^(?:<br\s*\/?>\s*)+$/i.test(trimmed)
    ) {
      continue;
    }

    // HTML Paragraph or Div with optional attributes
    const pTagMatch = trimmed.match(/^<(p|div)(?:\s+([^>]*?))?>(.*?)<\/\1>$/i);
    if (pTagMatch) {
      const attrs = pTagMatch[2] || '';
      const inner = pTagMatch[3].trim();
      if (!inner || /^(?:&nbsp;|&#160;|\s|<br\s*\/?>)*$/i.test(inner)) {
        continue; // Skip empty HTML paragraphs/divs
      }

      let alignClass = '';
      if (/class=["'][^"']*text-center[^"']*["']/i.test(attrs) || /align=["']center["']/i.test(attrs)) {
        alignClass = 'text-center';
      } else if (/class=["'][^"']*text-right[^"']*["']/i.test(attrs) || /align=["']right["']/i.test(attrs)) {
        alignClass = 'text-right';
      } else if (/class=["'][^"']*text-left[^"']*["']/i.test(attrs) || /align=["']left["']/i.test(attrs)) {
        alignClass = 'text-left';
      }

      let indentClass = '';
      const indentMatch = attrs.match(/class=["'][^"']*(indent-1|indent-2|indent-line|no-indent)[^"']*["']/i);
      if (indentMatch) {
        indentClass = indentMatch[1];
      }

      const combinedClasses = [alignClass, indentClass].filter(Boolean).join(' ');
      const classAttr = combinedClasses ? ` class="${combinedClasses}"` : '';

      seenContentLinesOnPage++;
      xhtmlParts.push(`<p${classAttr}>${formatInline(inner)}</p>`);
      continue;
    }

    // Active multi-line block alignments
    if (inCenterBlock) {
      seenContentLinesOnPage++;
      xhtmlParts.push(`<p class="text-center">${formatInline(trimmed)}</p>`);
      continue;
    }
    if (inRightBlock) {
      seenContentLinesOnPage++;
      xhtmlParts.push(`<p class="text-right">${formatInline(trimmed)}</p>`);
      continue;
    }

    // Indentation detection from leading whitespace
    if (rawLine.startsWith('    ') || rawLine.startsWith('\t')) {
      seenContentLinesOnPage++;
      xhtmlParts.push(`<p class="indent-line">${formatInline(trimmed)}</p>`);
      continue;
    } else if (rawLine.startsWith('  ')) {
      seenContentLinesOnPage++;
      xhtmlParts.push(`<p class="indent-1">${formatInline(trimmed)}</p>`);
      continue;
    }

    // Poetry / Stanza line detection: preserve tight intra-stanza line spacing and explicit stanza breaks
    const prevRaw = i > 0 ? lines[i - 1].trim() : '';
    const nextRaw = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const isPlainVerseCandidate = (s: string) =>
      Boolean(s) &&
      !s.startsWith('#') &&
      !s.startsWith('|') &&
      !s.startsWith('>') &&
      !s.startsWith('- ') &&
      !s.startsWith('* ') &&
      !s.includes('epub-page-anchor') &&
      !s.includes('[IMAGE_FIGURE:');

    if (
      isPlainVerseCandidate(trimmed) &&
      (isPlainVerseCandidate(prevRaw) || isPlainVerseCandidate(nextRaw) || trimmed.includes('॥'))
    ) {
      // Collect contiguous non-empty lines of this stanza
      let startIdx = i;
      while (startIdx > 0 && isPlainVerseCandidate(lines[startIdx - 1].trim())) {
        startIdx--;
      }
      let endIdx = i;
      while (endIdx + 1 < lines.length && isPlainVerseCandidate(lines[endIdx + 1].trim())) {
        endIdx++;
      }
      const stanzaCandidate = lines.slice(startIdx, endIdx + 1).join('\n');
      if (
        isPoetryOrVerseBlock(stanzaCandidate) ||
        isUnmarkedProsePoetryBlock(stanzaCandidate).isProsePoetry
      ) {
        const isLastLineOfStanza = i === endIdx;
        const stanzaClass = isLastLineOfStanza ? 'verse-line stanza-end' : 'verse-line';
        seenContentLinesOnPage++;
        xhtmlParts.push(`<p class="${stanzaClass}">${formatInline(trimmed)}</p>`);
        continue;
      }
    }

    // Standard paragraph
    seenContentLinesOnPage++;
    xhtmlParts.push(`<p>${formatInline(trimmed)}</p>`);
  }

  closeOpenListsAndTables();
  if (inCenterBlock) xhtmlParts.push('</div>');
  if (inRightBlock) xhtmlParts.push('</div>');
  if (inTocList) xhtmlParts.push('</ul></nav></div>');

  const joinedXhtml = xhtmlParts.join('\n');
  if (options.skipPostNormalize) {
    return joinedXhtml;
  }
  const initialXhtml = normalizeHtmlToXhtml(joinedXhtml);
  const { normalizedXhtml } = normalizeEpubLayoutXhtml(initialXhtml);
  return normalizeHtmlToXhtml(normalizedXhtml);
}

/**
 * Handles bold, italic, code inline formatting safely without breaking valid HTML tags
 */
export function formatInline(text: string): string {
  if (!text) return '';
  const cleaned = stripInvalidXmlChars(text);
  const converted = cleaned
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const tagRegex = /(<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*?)?>)/g;
  const parts = converted.split(tagRegex);
  return parts
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return part;
      }
      return sanitizeXmlEntities(part)
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    })
    .join('');
}

interface EmittedChapterHeadingInfo {
  id: string;
  level: number;
  text: string;
  combinedText: string;
}

function extractEmittedIdsAndHeadings(xhtml: string): {
  ids: Set<string>;
  headings: EmittedChapterHeadingInfo[];
} {
  const ids = new Set<string>();
  const idRegex = /\bid=["']([^"']+)["']/gi;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(xhtml)) !== null) {
    if (idMatch[1]) ids.add(idMatch[1]);
  }

  const headings: EmittedChapterHeadingInfo[] = [];
  // Extract chapter opener headers with optional chapter-number-label + h1
  const openerRegex = /<header\b[^>]*class=["'][^"']*chapter-opener[^"']*["'][^>]*>([\s\S]*?)<\/header>/gi;
  let openerMatch: RegExpExecArray | null;
  const handledHeadingIds = new Set<string>();

  while ((openerMatch = openerRegex.exec(xhtml)) !== null) {
    const inner = openerMatch[1];
    const labelMatch = inner.match(/<p\b[^>]*class=["'][^"']*chapter-number-label[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const h1Match = inner.match(/<h1\b[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const id = h1Match[1];
      const h1Text = h1Match[2].replace(/<[^>]+>/g, '').trim();
      const labelText = labelMatch ? labelMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const combinedText = labelText ? `${labelText}: ${h1Text}` : h1Text;
      handledHeadingIds.add(id);
      headings.push({
        id,
        level: 1,
        text: h1Text,
        combinedText,
      });
    }
  }

  const headingRegex = /<h([1-4])\b[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(xhtml)) !== null) {
    const level = parseInt(hMatch[1], 10);
    const id = hMatch[2];
    if (handledHeadingIds.has(id)) continue;
    const text = hMatch[3].replace(/<[^>]+>/g, '').trim();
    headings.push({
      id,
      level,
      text,
      combinedText: text,
    });
  }

  return { ids, headings };
}

/**
 * Synchronizes every TOC node in the tree against the actual emitted XHTML chapter files and heading IDs.
 * Ensures that:
 * 1. Valid `page_N` anchors and page-specific `toc-h-pN-...` heading anchors that exist in the target XHTML file are strictly preserved.
 * 2. Consolidated continuation page `page_N` anchors are never overwritten by `fileHeadings[0].id`.
 * 3. Partial/short substring matches never hijack a TOC entry to a distant chapter file.
 * 4. Genuinely missing targets are marked `unresolved` rather than silently redirected to an unrelated chapter heading.
 */
export function synchronizeTocTreeWithGeneratedChapters(
  nodes: EpubTocItem[],
  emittedIdsByFile: Map<string, Set<string>>,
  emittedHeadingsByFile: Map<string, EmittedChapterHeadingInfo[]>,
  fallbackContentHref: string,
  unresolvedWarnings?: string[]
): EpubTocItem[] {
  const emittedFiles = Array.from(emittedIdsByFile.keys());
  if (emittedFiles.length === 0) return nodes;

  const extractHeadingPageNumber = (headingId: string): number | null => {
    const m = headingId.match(/^toc-h-p(\d+)-/);
    return m ? parseInt(m[1], 10) : null;
  };

  const findHeadingMatchInFile = (
    file: string,
    searchTitle: string,
    expectedPageNumber?: number,
    expectedLevel?: 1 | 2 | 3 | 4
  ): EmittedChapterHeadingInfo | undefined => {
    const list = emittedHeadingsByFile.get(file);
    if (!list || list.length === 0) return undefined;

    let bestOnExpectedPage: { heading: EmittedChapterHeadingInfo; score: number } | undefined;
    let bestInSameChapterWindow: { heading: EmittedChapterHeadingInfo; score: number } | undefined;

    for (const h of list) {
      const scoreText = scoreTocToHeadingMatch(searchTitle, h.text, expectedLevel, h.level);
      const scoreCombined = scoreTocToHeadingMatch(searchTitle, h.combinedText, expectedLevel, h.level);
      const score = Math.max(scoreText, scoreCombined);
      if (score < 0.78) continue;

      const hPage = extractHeadingPageNumber(h.id);
      if (expectedPageNumber !== undefined && hPage !== null) {
        if (hPage === expectedPageNumber) {
          if (!bestOnExpectedPage || score > bestOnExpectedPage.score) {
            bestOnExpectedPage = { heading: h, score };
          }
        } else if (Math.abs(hPage - expectedPageNumber) <= 2 && score >= 0.85) {
          if (!bestInSameChapterWindow || score > bestInSameChapterWindow.score) {
            bestInSameChapterWindow = { heading: h, score };
          }
        }
      } else {
        if (!bestInSameChapterWindow || score > bestInSameChapterWindow.score) {
          bestInSameChapterWindow = { heading: h, score };
        }
      }
    }

    return bestOnExpectedPage?.heading || bestInSameChapterWindow?.heading;
  };

  const findEmittedFileOwningPage = (pageNum: number): string | undefined => {
    const directFile = `page_${pageNum}.xhtml`;
    if (emittedIdsByFile.has(directFile)) return directFile;
    const pageAnchor = `page_${pageNum}`;
    const headingPrefix = `toc-h-p${pageNum}-`;
    for (const [file, ids] of emittedIdsByFile.entries()) {
      if (ids.has(pageAnchor)) return file;
      for (const id of ids) {
        if (id.startsWith(headingPrefix)) return file;
      }
    }
    return undefined;
  };

  const syncNode = (node: EpubTocItem): EpubTocItem => {
    const [rawFile, rawHash] = (node.targetHref || '').split('#');
    let targetFile = rawFile || `page_${node.targetPageNumber}.xhtml`;
    let wasMissingTargetFile = false;

    if (!emittedIdsByFile.has(targetFile)) {
      const owningFile = findEmittedFileOwningPage(node.targetPageNumber);
      if (owningFile) {
        targetFile = owningFile;
      } else {
        wasMissingTargetFile = true;
        const targetNumMatch = targetFile.match(/page_(\d+)\.xhtml/);
        const targetNum = targetNumMatch ? parseInt(targetNumMatch[1], 10) : node.targetPageNumber;
        let bestFile = fallbackContentHref;
        let bestDiff = Infinity;
        for (const candidateFile of emittedFiles) {
          const m = candidateFile.match(/page_(\d+)\.xhtml/);
          if (m) {
            const pNum = parseInt(m[1], 10);
            const diff = Math.abs(pNum - targetNum);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestFile = candidateFile;
            }
          }
        }
        targetFile = bestFile;
      }
    }

    const fileIds = emittedIdsByFile.get(targetFile) || new Set<string>();
    let resolvedAnchorId: string | undefined = rawHash || node.anchorId;
    let updatedReviewStatus = node.reviewStatus;

    // 1. If the node already has a valid anchor ID (either `toc-h-pN-...` or `page_N`) that exists in targetFile, preserve it!
    if (resolvedAnchorId && fileIds.has(resolvedAnchorId)) {
      // Valid anchor exists in targetFile — keep it intact.
    } else {
      // 2. Search headings within targetFile using conservative multi-signal matching
      const matchedInTarget = findHeadingMatchInFile(
        targetFile,
        node.title,
        node.targetPageNumber,
        node.level
      );
      if (matchedInTarget) {
        resolvedAnchorId = matchedInTarget.id;
      } else {
        // 3. Preserve valid `page_N` anchor if present in targetFile (critical for consolidated continuation pages)
        const pageAnchor = `page_${node.targetPageNumber}`;
        if (fileIds.has(pageAnchor)) {
          resolvedAnchorId = pageAnchor;
        } else {
          // 4. Only use fileHeadings[0].id if targetFile IS the starting page of this chapter (never a continuation page)
          //    and there is no conflicting chapter number.
          const fileHeadings = emittedHeadingsByFile.get(targetFile) || [];
          const isStartingPageOfFile = targetFile === `page_${node.targetPageNumber}.xhtml` && !wasMissingTargetFile;
          const firstHeading = fileHeadings[0];
          const firstHeadingPage = firstHeading ? extractHeadingPageNumber(firstHeading.id) : null;
          const tocProfile = buildHeadingMatchProfile(node.title);
          const firstHeadingProfile = firstHeading
            ? buildHeadingMatchProfile(firstHeading.combinedText || firstHeading.text)
            : null;
          const hasNumberConflict =
            firstHeadingProfile ? hasConflictingChapterNumbers(tocProfile, firstHeadingProfile) : true;

          if (
            isStartingPageOfFile &&
            node.level === 1 &&
            firstHeading &&
            firstHeading.level === 1 &&
            (firstHeadingPage === null || firstHeadingPage === node.targetPageNumber) &&
            !hasNumberConflict &&
            (!rawHash && !node.anchorId)
          ) {
            resolvedAnchorId = firstHeading.id;
          } else {
            resolvedAnchorId = undefined;
            if (rawHash || node.anchorId || wasMissingTargetFile) {
              updatedReviewStatus = 'unresolved';
              if (unresolvedWarnings) {
                unresolvedWarnings.push(
                  `TOC entry "${node.title}" (target page ${node.targetPageNumber}) could not resolve anchor "${rawHash || node.anchorId || 'page_' + node.targetPageNumber}" in ${targetFile}.`
                );
              }
            }
          }
        }
      }
    }

    const updatedHref = resolvedAnchorId ? `${targetFile}#${resolvedAnchorId}` : targetFile;
    const syncedChildren =
      node.children && node.children.length > 0
        ? node.children.map((child) => syncNode(child))
        : [];

    return {
      ...node,
      anchorId: resolvedAnchorId,
      targetHref: updatedHref,
      reviewStatus: updatedReviewStatus,
      children: syncedChildren,
    };
  };

  return nodes.map((n) => syncNode(n));
}

export interface EpubGenerationResult {
  blob: Blob;
  filename: string;
  diagnostics?: TocDiagnostics;
  validationReport?: PackageValidationReport;
  layoutReport?: LayoutCleanupReport;
  canonicalOutline?: CanonicalDocumentOutline;
}

/**
 * Generates an EPUB 3 document with dual EPUB 2 NCX, full hierarchical Table of Contents,
 * and maximum cross-device e-reader compatibility (Kindle, Apple Books, Google Play Books, Kobo, Moon+ Reader, Calibre).
 */
export async function generateEpubBlob(
  bookDetails: BookDetails,
  pages: PageItem[],
  coverImageBase64?: string | null,
  preferredFont: 'noto' | 'kalpurush' | 'solaiman' | 'siliguri' = 'noto',
  structureConfig?: StructureConfig,
  pdfOutline?: PdfOutlineItem[],
  options?: { smartSpacing?: boolean }
): Promise<EpubGenerationResult> {
  const smartSpacingEnabled = options?.smartSpacing !== false;
  const zip = new JSZip();

  // 1. mimetype (MUST be first entry, UNCOMPRESSED / STORE method for IDPF validator compliance)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder('OEBPS')!;
  const sanitizedPages = sanitizePagesForExport(pages, bookDetails);
  const lang = detectDocumentLanguage(sanitizedPages, bookDetails);
  const bookTitle = correctBengaliMixedScriptText(bookDetails.title || (lang === 'bn' ? 'বাংলা বই' : 'Ebook'));
  const author = correctBengaliMixedScriptText(bookDetails.author || (lang === 'bn' ? 'অজ্ঞাত লেখক' : 'Unknown Author'));
  const publisher = correctBengaliMixedScriptText(bookDetails.publisher || (lang === 'bn' ? 'ইপাব প্রকাশনী' : 'EPUB Publisher'));
  const bookId = 'urn:uuid:' + (bookDetails.isbn || `${lang}-epub-` + Date.now());
  const dateStr = bookDetails.publishYear || new Date().getFullYear().toString();

  const tocTitle = getTocTitleForLanguage(lang);
  const landmarksHeading = lang === 'bn' ? 'ল্যান্ডমার্কস' : 'Landmarks';
  const coverLabel = lang === 'bn' ? 'প্রচ্ছদ' : 'Cover';
  const startReadingLabel = lang === 'bn' ? 'পঠন শুরু' : 'Start Reading';

  // Robust font-family stack with Bengali and Universal system font fallbacks
  const fontStacks = {
    noto: '"Noto Sans Bengali", "Kalpurush", "SolaimanLipi", "Hind Siliguri", "Vrinda", "Bangla", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    kalpurush: '"Kalpurush", "Noto Sans Bengali", "SolaimanLipi", "Hind Siliguri", "Vrinda", "Bangla", serif',
    solaiman: '"SolaimanLipi", "Noto Sans Bengali", "Kalpurush", "Hind Siliguri", "Vrinda", "Bangla", serif',
    siliguri: '"Hind Siliguri", "Noto Sans Bengali", "Kalpurush", "Vrinda", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };
  const chosenFontFamily = fontStacks[preferredFont] || fontStacks.noto;

  // CSS Stylesheet optimized for all major e-readers and devices with Bengali-safe typography
  const css = `
@charset "utf-8";

/* Global Publication Typography & Device Safety */
html {
  font-size: 100%;
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 5% 7%;
  padding: 0;
  font-family: ${chosenFontFamily};
  font-size: 1.1em;
  line-height: 1.8;
  color: #1a1a1a;
  background-color: #ffffff;
  text-align: justify;
  /* Prevent broken Bengali conjuncts (যুক্তাক্ষর) */
  letter-spacing: 0 !important;
  font-variant-ligatures: normal;
  word-break: normal !important;
  overflow-wrap: break-word !important;
  hyphens: none !important;
  -webkit-hyphens: none !important;
  -moz-hyphens: none !important;
}

h1, h2, h3, h4 {
  font-family: ${chosenFontFamily};
  font-weight: bold;
  line-height: 1.35;
  color: #111827;
  letter-spacing: 0 !important;
  page-break-after: avoid;
  break-after: avoid;
  word-break: normal !important;
  overflow-wrap: break-word !important;
  hyphens: none !important;
}

h1 {
  font-size: 1.75em;
  text-align: center;
  margin-top: 1.4em;
  margin-bottom: 0.7em;
  border-bottom: 1.5px solid #e5e7eb;
  padding-bottom: 0.3em;
}

h2, .section-heading {
  font-size: 1.38em;
  margin-top: 1.35em;
  margin-bottom: 0.55em;
  color: #1f2937;
}

h3, .subsection-heading {
  font-size: 1.16em;
  margin-top: 1.1em;
  margin-bottom: 0.4em;
  color: #374151;
}

h4 {
  font-size: 1.05em;
  margin-top: 0.9em;
  margin-bottom: 0.3em;
  color: #4b5563;
}

/* ========================================================
   Publication-Grade Chapter Opener Block
   ======================================================== */
.chapter-opener {
  margin-top: 2.2em;
  margin-bottom: 1.8em;
  padding: 0.4em 0.5em 0.2em 0.5em;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
  page-break-after: avoid;
  break-after: avoid;
}

.chapter-number-label {
  font-size: 0.95em;
  font-weight: 600;
  color: #4b5563;
  text-align: center !important;
  text-indent: 0 !important;
  letter-spacing: 0 !important;
  margin: 0 0 0.35em 0 !important;
  line-height: 1.4;
}

.chapter-opener h1,
.chapter-opener .chapter-title {
  font-size: 1.8em;
  font-weight: 700;
  line-height: 1.35;
  text-align: center !important;
  text-indent: 0 !important;
  letter-spacing: 0 !important;
  margin: 0.1em 0 0.55em 0 !important;
  padding-bottom: 0;
  border-bottom: none;
  color: #111827;
}

.chapter-opener-divider {
  width: 4.5em;
  height: 0;
  border: none;
  border-top: 2px solid #9ca3af;
  margin: 0.65em auto 0.2em auto;
}

p {
  margin-top: 0;
  margin-bottom: 1em;
  text-indent: 1.5em;
}

/* Opening paragraph immediately following a chapter opener or heading has clean flush-left start */
.chapter-opener + p,
h1 + p,
h2 + p {
  text-indent: 0;
}

/* Alignments */
.text-center, p.text-center, div.text-center, h1.text-center, h2.text-center, h3.text-center, h4.text-center {
  text-align: center !important;
  text-indent: 0 !important;
}

.text-left, p.text-left, div.text-left {
  text-align: left !important;
}

.text-right, p.text-right, div.text-right {
  text-align: right !important;
  text-indent: 0 !important;
}

.text-justify, p.text-justify, div.text-justify {
  text-align: justify !important;
}

/* Indentation Styles */
.no-indent, p.no-indent {
  text-indent: 0 !important;
}

.indent-1, p.indent-1 {
  text-indent: 2.2em !important;
}

.indent-2, p.indent-2 {
  text-indent: 4em !important;
}

.indent-line, p.indent-line {
  margin-left: 2em !important;
  text-indent: 0 !important;
}

.indent-block, div.indent-block, blockquote.indent-block {
  margin-left: 2.5em !important;
  margin-right: 1.5em !important;
  text-indent: 0 !important;
}

.section-divider {
  text-align: center !important;
  text-indent: 0 !important;
  letter-spacing: 0.35em;
  margin: 1.6em 0;
  color: #4b5563;
  font-weight: bold;
}

.bengali-quote {
  margin: 1.2em 1.5em;
  padding: 0.6em 1.2em;
  border-left: 4px solid #6366f1;
  background-color: #f8fafc;
  font-style: italic;
}

.quote-line {
  margin-bottom: 0.3em;
  text-indent: 0;
}

.footnote {
  font-size: 0.9em;
  color: #6b7280;
  border-top: 1px solid #e5e7eb;
  padding-top: 0.5em;
  margin-top: 1.5em;
}

.book-figure {
  margin: 1.5em 0;
  max-width: 100%;
  page-break-inside: avoid;
  break-inside: avoid;
}

.book-figure.fig-left, .fig-left {
  text-align: left !important;
  margin-right: auto !important;
}

.book-figure.fig-center, .fig-center {
  text-align: center !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

.book-figure.fig-right, .fig-right {
  text-align: right !important;
  margin-left: auto !important;
}

.book-img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.figure-frame {
  border: 1px dashed #cbd5e1;
  padding: 1.5em;
  background-color: #f8fafc;
  border-radius: 6px;
  margin-bottom: 0.5em;
}

.figure-caption {
  font-size: 0.88em;
  color: #4b5563;
  margin-top: 0.4em;
  text-indent: 0 !important;
  font-style: italic;
}

.epub-table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.2em 0;
  font-size: 0.95em;
  page-break-inside: avoid;
  break-inside: avoid;
}

.epub-table td, .epub-table th {
  border: 1px solid #cbd5e1;
  padding: 0.45em 0.65em;
  text-align: left;
}

.epub-page-anchor {
  display: inline;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  line-height: 0;
  font-size: 0;
}

.verse-line, p.verse-line {
  text-indent: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0.2em !important;
  line-height: 1.75;
}

.stanza-end, p.stanza-end {
  margin-bottom: 1.15em !important;
}

.cover-page {
  text-align: center;
  margin: 0;
  padding: 0;
}

.cover-img {
  max-width: 100%;
  max-height: 96vh;
  margin: 0 auto;
}

/* ========================================================
   Professional Publication-Grade Table of Contents (TOC)
   ======================================================== */
.toc-wrapper {
  margin: 1.5em auto;
  max-width: 38em;
  padding: 0 0.5em;
}

.toc-header {
  text-align: center;
  margin-bottom: 2em;
}

.toc-title {
  font-size: 1.8em;
  font-weight: 700;
  letter-spacing: 0 !important;
  margin: 0.5em 0 0.25em 0;
  text-align: center;
  border-bottom: none;
  padding-bottom: 0;
  color: #111827;
}

.toc-book-title {
  font-size: 1.05em;
  font-style: italic;
  margin: 0.2em 0;
  text-indent: 0 !important;
  color: #4b5563;
}

.toc-book-author {
  font-size: 0.9em;
  margin: 0.2em 0;
  text-indent: 0 !important;
  color: #6b7280;
}

.toc-ornament {
  font-size: 0.8em;
  letter-spacing: 0.5em;
  color: #9ca3af;
  margin: 1em 0 1.5em 0;
  text-align: center;
}

.toc-divider {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1em 0 1.5em 0;
}

.toc-body {
  margin-top: 1em;
}

.toc-list, .toc-sublist {
  list-style: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

.toc-sublist {
  margin-top: 0.2em !important;
  margin-bottom: 0.35em !important;
}

.toc-item {
  list-style: none !important;
  margin: 0 !important;
  padding: 0 !important;
  text-indent: 0 !important;
}

/* Level 1: Major entries (Parts, Volumes, or Main Chapters) */
.toc-item.level-1 {
  margin-top: 1.1em !important;
  margin-bottom: 0.35em !important;
  font-size: 1.05em;
  font-weight: 700;
}

.toc-item.level-1 > .toc-link {
  font-weight: 700;
  color: #0f172a !important;
}

/* Level 2: Chapters under Parts, or Sections under Chapters */
.toc-list.level-2, .toc-sublist.level-2 {
  margin-left: 1.4em !important;
  padding-left: 0.2em !important;
}

.toc-item.level-2 {
  margin-top: 0.35em !important;
  margin-bottom: 0.25em !important;
  font-size: 0.96em;
  font-weight: 500;
}

.toc-item.level-2 > .toc-link {
  font-weight: 500;
  color: #334155 !important;
}

/* Level 3: Subsections */
.toc-list.level-3, .toc-sublist.level-3 {
  margin-left: 1.3em !important;
  padding-left: 0.2em !important;
}

.toc-item.level-3 {
  margin-top: 0.25em !important;
  margin-bottom: 0.2em !important;
  font-size: 0.88em;
  font-weight: 400;
}

.toc-item.level-3 > .toc-link {
  color: #475569 !important;
}

/* Level 4: Deep subsections */
.toc-list.level-4, .toc-sublist.level-4 {
  margin-left: 1.2em !important;
  padding-left: 0.2em !important;
}

.toc-item.level-4 {
  margin-top: 0.2em !important;
  margin-bottom: 0.2em !important;
  font-size: 0.84em;
  font-weight: 400;
}

.toc-item.level-4 > .toc-link {
  color: #64748b !important;
}

.toc-link {
  display: block !important;
  text-decoration: none !important;
  padding: 0.2em 0.3em;
  line-height: 1.5;
  letter-spacing: 0 !important;
  border-radius: 4px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.toc-link:hover, .toc-link:focus {
  color: #4f46e5 !important;
  text-decoration: underline !important;
}

.toc-text {
  display: inline;
  letter-spacing: 0 !important;
  word-break: normal;
  overflow-wrap: break-word;
}

/* Dark mode and night reading support */
@media (prefers-color-scheme: dark) {
  body {
    background-color: #121212;
    color: #e5e5e5;
  }
  h1, h2, h3, h4, .chapter-opener h1, .chapter-opener .chapter-title {
    color: #f3f4f6;
  }
  .chapter-number-label {
    color: #9ca3af;
  }
  .chapter-opener-divider {
    border-top-color: #4b5563;
  }
  .toc-title {
    color: #f9fafb !important;
  }
  .toc-book-title {
    color: #cbd5e1 !important;
  }
  .toc-book-author {
    color: #94a3b8 !important;
  }
  .toc-item.level-1 > .toc-link {
    color: #f1f5f9 !important;
  }
  .toc-item.level-2 > .toc-link {
    color: #cbd5e1 !important;
  }
  .toc-item.level-3 > .toc-link {
    color: #94a3b8 !important;
  }
  .toc-item.level-4 > .toc-link {
    color: #64748b !important;
  }
  .toc-link:hover, .toc-link:focus {
    color: #a5b4fc !important;
  }
}
`;
  oebps.file('styles.css', css);

  // Filter valid completed pages (using Unicode-validated & mixed-script corrected pages)
  const validPages = sanitizedPages.filter((p) => p.status !== 'excluded' && p.markdown.trim().length > 0);

  // Master Table of Contents extraction pipeline (Dedicated, Stage A, B, C, D, Fallback)
  let tocResult = extractAuthoritativeTocTree(validPages, {
    pdfOutline,
    structureConfig,
    bookDetails,
  });
  const identifiedTocPageNums = new Set(tocResult.tocPages);
  for (const pNum of detectTocPages(validPages, structureConfig)) {
    identifiedTocPageNums.add(pNum);
  }

  // Intelligent Document Layout Reconstruction & Gap Removal Stage:
  // 1. Strips repeated running headers/footers & artificial page-break elements
  // 2. Reorders multi-column pages into natural single-column reading sequence
  // 3. Reconstructs paragraphs continuing across PDF page boundaries (with confidence scoring)
  // 4. Consolidates non-chapter continuation pages into their parent chapter section while preserving chapter boundaries
  const layoutReconstruction = reconstructDocumentLayoutForEpub(validPages, {
    bookDetails,
    structureConfig,
    pdfOutline,
    tocTree: tocResult.tree,
    identifiedTocPageNums,
    smartSpacing: smartSpacingEnabled,
  });

  // If layout reconstruction stripped running headers/footers or reordered multi-column text,
  // re-resolve the TOC tree against cleanedPages (merging TOC pages back in if they were filtered out)
  // so heading counters on cleaned pages match the generated XHTML 100%.
  if (
    layoutReconstruction.report.runningHeadersFootersRemoved > 0 ||
    layoutReconstruction.report.multiColumnPagesReordered > 0
  ) {
    const cleanedByPageNum = new Map(layoutReconstruction.cleanedPages.map((p) => [p.pageNumber, p]));
    const pagesForUpdatedToc = validPages.map((p) => cleanedByPageNum.get(p.pageNumber) || p);
    tocResult = extractAuthoritativeTocTree(pagesForUpdatedToc, {
      pdfOutline,
      structureConfig,
      bookDetails,
    });
  }

  // Remap TOC tree links if any continuation page was consolidated into its parent chapter file
  const remappedTocTree = remapTocTreeForConsolidatedPages(
    tocResult.tree,
    layoutReconstruction.pageToSectionFileMap
  );
  const layoutReport = layoutReconstruction.report;

  // Cover image setup
  let hasCover = false;
  if (coverImageBase64) {
    const coverData = coverImageBase64.replace(/^data:image\/\w+;base64,/, '');
    oebps.file('cover.jpg', coverData, { base64: true });
    hasCover = true;

    // cover.xhtml
    const rawCoverBody = `<div class="cover-page">\n  <img src="cover.jpg" alt="${escapeXml(coverLabel)}" class="cover-img" />\n</div>`;
    const coverXhtml = buildCompleteXhtmlDocument(
      `${coverLabel} - ${bookTitle}`,
      normalizeHtmlToXhtml(rawCoverBody),
      lang
    );
    const coverCheck = validateXmlString(coverXhtml);
    if (!coverCheck.isValid) {
      throw new Error(`cover.xhtml XML validation failed: ${coverCheck.error}`);
    }
    oebps.file('cover.xhtml', coverXhtml);
  }

  // Chapters / Pages manifest & spine setup
  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  manifestItems.push(`<item id="style" href="styles.css" media-type="text/css"/>`);

  if (hasCover) {
    manifestItems.push(`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    manifestItems.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="cover"/>`);
  }

  // Include visual TOC in spine right after cover (or at front) and contents.xhtml in manifest
  manifestItems.push(`<item id="toc-view" href="toc.xhtml" media-type="application/xhtml+xml"/>`);
  manifestItems.push(`<item id="contents-view" href="contents.xhtml" media-type="application/xhtml+xml"/>`);
  spineItems.push(`<itemref idref="toc-view"/>`);

  const emittedIdsByFile = new Map<string, Set<string>>();
  const emittedHeadingsByFile = new Map<string, EmittedChapterHeadingInfo[]>();

  // Write each reconstructed chapter/section group
  layoutReconstruction.consolidatedGroups.forEach((group) => {
    const page = group.sectionPage;
    if (identifiedTocPageNums.has(page.pageNumber)) {
      return;
    }

    const pageId = `page_${page.pageNumber}`;
    const filename = `page_${page.pageNumber}.xhtml`;

    // Process & package any figures in this consolidated chapter section into OEBPS/figures/
    if (page.figures && page.figures.length > 0) {
      page.figures.forEach((fig, fIdx) => {
        const figDataUrl = fig.imageUrl || fig.dataUrl;
        if (figDataUrl && figDataUrl.startsWith('data:image')) {
          const isPng = figDataUrl.startsWith('data:image/png') || fig.mimeType === 'image/png';
          const ext = isPng ? 'png' : 'jpg';
          const mime = isPng ? 'image/png' : 'image/jpeg';
          const rawBase64 = figDataUrl.replace(/^data:image\/\w+;base64,/, '');
          const figFilename = `figures/page_${page.pageNumber}_fig_${fIdx + 1}.${ext}`;
          oebps.file(figFilename, rawBase64, { base64: true });
          manifestItems.push(
            `<item id="fig_${page.pageNumber}_${fIdx + 1}" href="${figFilename}" media-type="${mime}"/>`
          );
        }
      });
    }

    const rawPageContent = markdownToXhtml(page.markdown, page.figures, {
      isPreview: false,
      pageNumber: page.pageNumber,
      isTocPage: false,
      allPages: layoutReconstruction.cleanedPages.length > 0 ? layoutReconstruction.cleanedPages : validPages,
      skipPostNormalize: true,
      layoutBlocks: page.layoutBlocks,
    });

    const initialXhtml = normalizeHtmlToXhtml(rawPageContent);
    const layoutNorm = normalizeEpubLayoutXhtml(initialXhtml);
    const pageContent = normalizeHtmlToXhtml(layoutNorm.normalizedXhtml);
    layoutReport.emptyElementsRemoved += layoutNorm.emptyElementsRemoved;
    layoutReport.excessiveSpacingNormalized += layoutNorm.excessiveSpacingNormalized;

    const titleMatch = page.markdown.match(/^#+ (.*$)/m);
    const displayTitle = titleMatch
      ? cleanHeadingText(titleMatch[1])
      : lang === 'bn'
      ? `পৃষ্ঠা ${page.pageNumber}`
      : `Page ${page.pageNumber}`;

    let xhtml = buildCompleteXhtmlDocument(displayTitle, pageContent, lang);

    // Strict Per-Chapter XML & Layout Validation Gate with Safe Fallback
    let chapterCheck = validateXmlString(xhtml);
    if (!chapterCheck.isValid) {
      console.warn(
        `[EPUB Validation] Chapter page ${page.pageNumber} initially malformed (${chapterCheck.error}). Applying auto-repair...`
      );
      xhtml = repairMalformedXhtml(xhtml, displayTitle, lang);
      chapterCheck = validateXmlString(xhtml);
      if (!chapterCheck.isValid) {
        throw new Error(
          `অধ্যায় পৃষ্ঠা ${page.pageNumber}-এ ত্রুটিপূর্ণ XHTML রয়েছে যা স্বয়ংক্রিয়ভাবে সমাধান করা যায়নি: ${chapterCheck.error}`
        );
      }
    }

    const layoutCheck = validateEpubXhtmlLayout(xhtml, filename);
    if (!layoutCheck.isValid && layoutCheck.issues.length > 0) {
      layoutReport.warnings.push(...layoutCheck.issues);
    }

    const extractedInfo = extractEmittedIdsAndHeadings(xhtml);
    emittedIdsByFile.set(filename, extractedInfo.ids);
    emittedHeadingsByFile.set(filename, extractedInfo.headings);

    oebps.file(filename, xhtml);
    manifestItems.push(`<item id="${pageId}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${pageId}"/>`);
  });

  // First reading content page (first non-TOC section) for landmarks & Kindle guide
  const firstReadingGroup = layoutReconstruction.consolidatedGroups.find(
    (g) => !identifiedTocPageNums.has(g.sectionPage.pageNumber)
  );
  const firstContentHref = firstReadingGroup
    ? `page_${firstReadingGroup.sectionPage.pageNumber}.xhtml`
    : 'toc.xhtml';

  // Synchronize TOC tree against the actual emitted XHTML chapter files and heading anchor IDs
  const unresolvedSyncWarnings: string[] = [];
  const tocTree = synchronizeTocTreeWithGeneratedChapters(
    remappedTocTree,
    emittedIdsByFile,
    emittedHeadingsByFile,
    firstContentHref,
    unresolvedSyncWarnings
  );
  if (unresolvedSyncWarnings.length > 0) {
    tocResult.diagnostics.warnings.push(...unresolvedSyncWarnings);
    layoutReport.warnings.push(...unresolvedSyncWarnings);
  }

  // Build Canonical Document Outline from synchronized TOC tree and document metadata
  const canonicalOutline = buildCanonicalDocumentOutline(
    tocTree,
    validPages,
    bookDetails,
    lang,
    tocResult
  );

  // Generate Standalone Visual Table of Contents (toc.xhtml & contents.xhtml) from synchronized canonical outline
  const visualTocContent = generateVisualTocHtml(tocTree, bookTitle, author, lang);
  const normalizedVisualToc = normalizeHtmlToXhtml(visualTocContent);
  const visualTocXhtml = buildCompleteXhtmlDocument(
    `${tocTitle} - ${bookTitle}`,
    normalizedVisualToc,
    lang
  );
  const tocCheck = validateXmlString(visualTocXhtml);
  if (!tocCheck.isValid) {
    throw new Error(`toc.xhtml XML validation failed: ${tocCheck.error}`);
  }
  oebps.file('toc.xhtml', visualTocXhtml);
  oebps.file('contents.xhtml', visualTocXhtml);

  // 1. Navigation document (nav.xhtml for EPUB 3 with nested <ol> and landmarks)
  function renderNavOl(nodes: EpubTocItem[], depth: number = 1): string {
    if (!nodes || nodes.length === 0) return '';
    const items = nodes.map((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const subList = hasChildren ? `\n      ${renderNavOl(node.children, depth + 1)}` : '';
      return `<li><a href="${escapeXml(node.targetHref)}">${escapeXml(node.title)}</a>${subList}</li>`;
    });
    return `<ol class="toc-ol level-${depth}">\n      ${items.join('\n      ')}\n    </ol>`;
  }

  const navOlHtml = renderNavOl(tocTree, 1);

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(tocTitle)} - ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>${escapeXml(tocTitle)}</h1>
    ${navOlHtml}
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <h2>${escapeXml(landmarksHeading)}</h2>
    <ol>
      ${hasCover ? `<li><a epub:type="cover" href="cover.xhtml">${escapeXml(coverLabel)}</a></li>` : ''}
      <li><a epub:type="toc" href="toc.xhtml">${escapeXml(tocTitle)}</a></li>
      <li><a epub:type="bodymatter" href="${escapeXml(firstContentHref)}">${escapeXml(startReadingLabel)}</a></li>
    </ol>
  </nav>
</body>
</html>`;

  const navCheck = validateXmlString(navXhtml);
  if (!navCheck.isValid) {
    throw new Error(`nav.xhtml XML validation failed: ${navCheck.error}`);
  }
  oebps.file('nav.xhtml', navXhtml);
  manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);

  // 2. Legacy NCX table of contents for EPUB 2 & Kindle backward compatibility
  let playOrderCounter = 1;
  function renderNcxNavPoints(nodes: EpubTocItem[]): string {
    if (!nodes || nodes.length === 0) return '';
    return nodes.map((node) => {
      const currentOrder = playOrderCounter++;
      const childrenNcx = node.children && node.children.length > 0 ? renderNcxNavPoints(node.children) : '';
      return `
    <navPoint id="np-${escapeXml(node.id)}" playOrder="${currentOrder}">
      <navLabel><text>${escapeXml(node.title)}</text></navLabel>
      <content src="${escapeXml(node.targetHref)}"/>
      ${childrenNcx}
    </navPoint>`;
    }).join('');
  }

  const ncxMaxDepth = calculateMaxDepth(tocTree);
  const ncxNavPoints = renderNcxNavPoints(tocTree);

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
    <meta name="dtb:depth" content="${ncxMaxDepth}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>
    ${ncxNavPoints}
  </navMap>
</ncx>`;

  const ncxCheck = validateXmlString(tocNcx);
  if (!ncxCheck.isValid) {
    throw new Error(`toc.ncx XML validation failed: ${ncxCheck.error}`);
  }
  oebps.file('toc.ncx', tocNcx);
  manifestItems.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);

  // 3. content.opf package manifest with Kindle <guide> and dual navigation bindings
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title id="title">${escapeXml(bookTitle)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
    <dc:creator id="creator">${escapeXml(author)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:publisher>${escapeXml(publisher)}</dc:publisher>
    <dc:date>${escapeXml(dateStr)}</dc:date>
    <dc:description>${escapeXml(bookDetails.description || 'Professional EPUB with hierarchical Table of Contents')}</dc:description>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.[0-9]+Z$/, 'Z')}</meta>
    ${hasCover ? '<meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
  <guide>
    ${hasCover ? `<reference type="cover" title="${escapeXml(coverLabel)}" href="cover.xhtml"/>` : ''}
    <reference type="toc" title="${escapeXml(tocTitle)}" href="toc.xhtml"/>
    <reference type="text" title="${escapeXml(startReadingLabel)}" href="${escapeXml(firstContentHref)}"/>
  </guide>
</package>`;

  const opfCheck = validateXmlString(contentOpf);
  if (!opfCheck.isValid) {
    throw new Error(`content.opf XML validation failed: ${opfCheck.error}`);
  }
  oebps.file('content.opf', contentOpf);

  // 4. Final Comprehensive EPUB Package Validation Gate
  const packageValidation = await validateEpubPackage(zip);
  if (!packageValidation.isValid) {
    throw new Error('EPUB প্যাকেজ ভ্যালিডেশন ত্রুটি:\n' + packageValidation.errors.join('\n'));
  }

  // Generate EPUB Blob
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const sanitizedFilename = (bookDetails.title || 'ebook')
    .replace(/[^a-zA-Z0-9\u0980-\u09FF\u0600-\u06FF\u0900-\u097F_-]/g, '_')
    .slice(0, 50);

  return {
    blob,
    filename: `${sanitizedFilename}.epub`,
    diagnostics: tocResult.diagnostics,
    validationReport: packageValidation,
    layoutReport,
    canonicalOutline,
  };
}


