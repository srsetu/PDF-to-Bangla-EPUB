export type BookType = 'single' | 'anthology' | 'volume';

export interface BookDetails {
  title: string;
  author: string;
  publisher: string;
  genre: string;
  publishYear?: string;
  isbn?: string;
  description?: string;
}

export interface StructureConfig {
  bookType: BookType;
  hasPrintedToc: boolean;
  includeTocInEpub: boolean;
  excludedPagesStr: string; // e.g. "1, 2, 45"
  excludedPagesList: number[];
  tocPagesStr: string; // e.g. "3, 4"
}

export interface WatermarkConfig {
  filters: string[];
  removeHeaderFooter: boolean;
  trimMarginArtifacts: boolean;
}

export type ModelOption = 'LTLB' | 'LTGB' | 'HTAV' | 'VHBB';
export type LanguageOption = 'bn' | 'bn-en';
export type ExtractionMode = 'smart' | 'text' | 'image';

export interface ConversionSettings {
  model: ModelOption;
  language: LanguageOption;
  batchSize: number; // 1 to 5
  mode: ExtractionMode;
}

export interface PageFigure {
  caption: string;
  type: string;
  imageUrl?: string;
  dataUrl?: string;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  align?: 'left' | 'center' | 'right';
  originalWidth?: number;
  originalHeight?: number;
  isDirectEmbedded?: boolean;
  mimeType?: string;
  objId?: string;
}

export interface OcrTokenRegion {
  topPercent: number;
  leftPercent: number;
  widthPercent: number;
  heightPercent: number;
  box2d: [number, number, number, number];
}

export interface OcrCorrectionEntry {
  originalToken: string;
  correctedToken: string;
  lineNumber: number;
  contextSentence: string;
  scriptsDetected: string[];
  reason:
    | 'mixed_script_in_word'
    | 'isolated_indic_script_in_bengali_sentence'
    | 'latin_homoglyph_in_bengali'
    | 'malformed_vowel_sign'
    | 'broken_conjunct';
  confidence: 'high' | 'medium' | 'low';
  method: 'unicode_contextual' | 'image_verified';
  region?: OcrTokenRegion;
}

export interface OcrFlaggedToken {
  token: string;
  lineNumber: number;
  charIndexInLine: number;
  contextSentence: string;
  scriptsDetected: string[];
  reason:
    | 'mixed_script_in_word'
    | 'isolated_indic_script_in_bengali_sentence'
    | 'latin_homoglyph_in_bengali'
    | 'malformed_vowel_sign'
    | 'broken_conjunct'
    | 'ambiguous_substitution';
  confidence: 'low' | 'medium';
  plausibleCandidates: string[];
  region: OcrTokenRegion;
}

export interface OcrValidationReport {
  primaryLanguage: 'bn' | 'bn-en' | 'en' | 'hi' | 'ar';
  isBengaliDocument: boolean;
  isMixedBengaliEnglish: boolean;
  correctionsApplied: OcrCorrectionEntry[];
  flaggedTokens: OcrFlaggedToken[];
  hasSuspiciousTokens: boolean;
  imageVerificationUsed?: boolean;
}

export interface PdfTextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  pageNumber?: number;
  columnIndex?: number;
}

export type ContinuationConfidence = 'high' | 'medium' | 'low' | 'none';

export interface PageBoundaryMergeDecision {
  fromPage: number;
  toPage: number;
  shouldMergeParagraph: boolean;
  shouldConsolidateSection: boolean;
  confidence: ContinuationConfidence;
  score: number;
  signals: string[];
  nonMergeReason?: string;
}

export interface LayoutCleanupReport {
  totalInputPages: number;
  totalOutputSections: number;
  multiColumnPagesReordered: number;
  crossPageParagraphsMerged: number;
  artificialPageBreaksRemoved: number;
  runningHeadersFootersRemoved: number;
  emptyElementsRemoved: number;
  excessiveSpacingNormalized: number;
  duplicateBoundaryLinesRemoved: number;
  lowConfidenceBoundariesPreserved: number;
  chaptersIntact: boolean;
  contentLosslessVerified: boolean;
  decisions: PageBoundaryMergeDecision[];
  warnings: string[];
}

export interface PageItem {
  pageNumber: number;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'excluded';
  thumbnailUrl: string | null;
  fullImageUrl: string | null;
  markdown: string;
  originalOcr: string;
  figures: PageFigure[];
  isTocPage: boolean;
  hasImages?: boolean;
  appliedMode?: ExtractionMode;
  errorMsg?: string;
  chapterTitle?: string;
  ocrValidation?: OcrValidationReport;
  layoutBlocks?: PdfTextBlock[];
  columnCount?: 1 | 2 | 3;
}

export interface ProcessingState {
  isConverting: boolean;
  currentPageNumber: number | null;
  currentPhase: 'idle' | 'rendering' | 'ocr' | 'image_detect' | 'cleanup' | 'complete';
  completedCount: number;
  totalCount: number;
  logMessages: string[];
}

export interface EpubTocItem {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  targetPageNumber: number;
  targetHref: string;
  anchorId?: string;
  rawLine?: string;
  children: EpubTocItem[];
}

export interface PdfOutlineItem {
  title: string;
  dest?: any;
  items?: PdfOutlineItem[];
  pageNumber?: number;
}

export interface TocDiagnostics {
  outlineFound: boolean;
  outlineItemCount: number;
  identifiedTocPages: number[];
  extractedEntriesCount: number;
  validatedEntriesCount: number;
  duplicatesRemovedCount: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
  fallbackUsed: boolean;
  fallbackReason?: string;
  linksResolvedCount: number;
  unresolvedCount: number;
  pipelineDurationMs: number;
}


