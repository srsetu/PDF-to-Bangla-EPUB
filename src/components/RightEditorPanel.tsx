import React, { useState, useEffect, useRef } from 'react';
import { PageItem, ProcessingState, ConversionSettings, ExtractionMode } from '../types';
import { markdownToXhtml, isTableOfContentsText, isLikelyTocPage } from '../utils/epubGenerator';
import {
  splitMarkdownIntoLogicalBlocks,
  evaluateParagraphContinuation,
  detectAndStripRunningHeadersFooters,
} from '../utils/epubLayoutPipeline';
import { validateAndCorrectBengaliOcr } from '../utils/bengaliOcrPipeline';
import { formatFriendlyErrorMessage } from '../utils/errorHelper';
import { formatElapsedTime, formatBengaliDuration } from '../utils/timeHelper';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  Minus,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Eye,
  Edit3,
  Image as ImageIcon,
  BookOpen,
  Columns,
  RotateCw,
  AlertTriangle,
  Play,
  Pause,
  RefreshCcw,
  Radio,
  FileSearch,
  Cpu,
  CheckCircle2,
  Clock,
  CheckCircle,
  BarChart3,
  ChevronUp,
  ChevronDown,
  Activity,
  Palette,
  Type,
  Maximize2,
  Minimize2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Indent,
  ListOrdered,
} from 'lucide-react';

interface RightEditorPanelProps {
  currentPage: PageItem | null;
  currentPageIndex: number;
  pages: PageItem[];
  totalPages: number;
  processingState: ProcessingState;
  conversionSettings: ConversionSettings;
  errorCount: number;
  onUpdateMarkdown: (newMarkdown: string) => void;
  onResetToOcr: () => void;
  onRescanPage: (pageIndex?: number) => void;
  onRescanErrors: () => void;
  onStartConversion: () => void;
  onPauseConversion: () => void;
  onGoLive: () => void;
  onChangeBatchSize: (size: number) => void;
  onToggleExclude?: (index: number) => void;
  onChangeMode?: (mode: ExtractionMode) => void;
  onSelectPage?: (index: number) => void;
  width?: number;
  elapsedSeconds?: number;
  isLiveTracking?: boolean;
  onToggleLiveTracking?: () => void;
}

export const RightEditorPanel: React.FC<RightEditorPanelProps> = ({
  currentPage,
  currentPageIndex,
  pages,
  totalPages,
  processingState,
  conversionSettings,
  errorCount,
  onUpdateMarkdown,
  onResetToOcr,
  onRescanPage,
  onRescanErrors,
  onStartConversion,
  onPauseConversion,
  onGoLive,
  onChangeBatchSize,
  onToggleExclude,
  onChangeMode,
  onSelectPage,
  width,
  elapsedSeconds = 0,
  isLiveTracking = false,
  onToggleLiveTracking,
}) => {
  // Default to Realistic EPUB Book Preview (User requirement)
  const [activeTab, setActiveTab] = useState<'editor' | 'preview' | 'split' | 'figures'>('preview');
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [readerTheme, setReaderTheme] = useState<'paper' | 'clean' | 'sepia' | 'night'>('paper');
  const [readerFont, setReaderFont] = useState<'noto' | 'kalpurush' | 'solaiman' | 'siliguri'>('noto');
  const [isMonitorExpanded, setIsMonitorExpanded] = useState<boolean>(true);

  // Vertical Editor Resizing State (User requirement)
  const [editorHeight, setEditorHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bangla_epub_editor_height');
      return saved ? parseInt(saved, 10) : 460;
    } catch {
      return 460;
    }
  });
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingHeight) {
        const container = document.getElementById('right-panel-container');
        if (container) {
          const rect = container.getBoundingClientRect();
          const newHeight = Math.max(160, Math.min(rect.height - 180, e.clientY - rect.top));
          setEditorHeight(newHeight);
          try {
            localStorage.setItem('bangla_epub_editor_height', String(Math.round(newHeight)));
          } catch {}
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingHeight(false);
    };

    if (isDraggingHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingHeight]);

  if (!currentPage) {
    return (
      <div
        style={width ? { width: `${width}px` } : undefined}
        className="w-full md:w-[540px] flex-shrink-0 p-8 flex flex-col items-center justify-center text-slate-400 text-xs bg-white border-l border-slate-200"
      >
        <BookOpen className="w-10 h-10 mb-3 text-slate-300 stroke-[1.5]" />
        <span>কোনো পৃষ্ঠা নির্বাচিত নেই</span>
        <span className="text-[11px] text-slate-400 mt-1">বাম পাশের তালিকা থেকে একটি পৃষ্ঠা নির্বাচন করুন।</span>
      </div>
    );
  }

  const markdown = currentPage.markdown || '';
  const liveValidation = validateAndCorrectBengaliOcr(markdown, {
    language: conversionSettings.language,
  });
  const activeFlaggedTokens = liveValidation.validationReport.flaggedTokens;
  const hasAutoFixableScriptErrors = liveValidation.correctedText !== markdown;

  // Statistics
  const words = markdown.trim() ? markdown.trim().split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const charCount = markdown.length;
  const lineCount = markdown.trim() ? markdown.split('\n').length : 0;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 160));

  // Progress percentage calculation: strictly clamped to 100% and derived from completed / eligible
  const eligiblePages = pages.filter((p) => p.status !== 'excluded');
  const completedCount = pages.filter((p) => p.status === 'completed').length;
  const totalEligible = eligiblePages.length;
  const progressPercentage =
    totalEligible > 0 ? Math.min(100, Math.round((completedCount / totalEligible) * 100)) : 0;

  const canGoLive =
    processingState.isConverting &&
    processingState.currentPageNumber !== null &&
    processingState.currentPageNumber !== currentPage.pageNumber;

  const handleInsertSyntax = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('markdown-textarea') as HTMLTextAreaElement | null;
    if (!textarea) {
      onUpdateMarkdown(markdown + '\n' + prefix + suffix);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = markdown.substring(start, end);

    const replacement = prefix + (selectedText || 'লেখা') + suffix;
    const updated = markdown.substring(0, start) + replacement + markdown.substring(end);
    onUpdateMarkdown(updated);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selectedText.length || 4));
    }, 10);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Reconstruct cross-page paragraph continuation for live EPUB preview when Smart Spacing is enabled
  const previewMarkdown = React.useMemo(() => {
    if (!markdown || conversionSettings.smartSpacing === false) return markdown;
    if (isLikelyTocPage(currentPage, pages)) return markdown;

    const { cleanedPages } = detectAndStripRunningHeadersFooters(pages);
    const currCleaned =
      cleanedPages.find((p) => p.pageNumber === currentPage.pageNumber)?.markdown || markdown;
    const currBlocks = splitMarkdownIntoLogicalBlocks(currCleaned);
    if (currBlocks.length === 0) return markdown;

    // Check if previous completed non-excluded page's last block continues into currentPage's first block
    const prevPage = [...cleanedPages]
      .reverse()
      .find(
        (p) =>
          p.pageNumber < currentPage.pageNumber &&
          p.status !== 'excluded' &&
          p.markdown &&
          p.markdown.trim().length > 0 &&
          !isLikelyTocPage(p, pages)
      );
    if (prevPage && prevPage.markdown) {
      const prevBlocks = splitMarkdownIntoLogicalBlocks(prevPage.markdown);
      const lastPrevBlock = prevBlocks[prevBlocks.length - 1];
      if (lastPrevBlock && currBlocks[0]) {
        const evalPrev = evaluateParagraphContinuation(lastPrevBlock, currBlocks[0], {
          isPageBoundary: true,
          nextPageIsChapterStart: false,
          prevPageBlocks: prevBlocks,
          nextPageBlocks: currBlocks,
          prevPageLayoutBlocks: prevPage.layoutBlocks,
          nextPageLayoutBlocks: currentPage.layoutBlocks,
        });
        if (evalPrev.shouldMerge && evalPrev.mergedText) {
          currBlocks[0] = evalPrev.mergedText;
        }
      }
    }

    // Check if currentPage's last block continues onto next completed non-excluded page's first block
    const nextPage = cleanedPages.find(
      (p) =>
        p.pageNumber > currentPage.pageNumber &&
        p.status !== 'excluded' &&
        p.markdown &&
        p.markdown.trim().length > 0 &&
        !isLikelyTocPage(p, pages)
    );
    if (nextPage && nextPage.markdown) {
      const nextBlocks = splitMarkdownIntoLogicalBlocks(nextPage.markdown);
      const firstNextBlock = nextBlocks[0];
      const lastCurrIdx = currBlocks.length - 1;
      if (currBlocks[lastCurrIdx] && firstNextBlock) {
        const evalNext = evaluateParagraphContinuation(currBlocks[lastCurrIdx], firstNextBlock, {
          isPageBoundary: true,
          nextPageIsChapterStart: false,
          prevPageBlocks: currBlocks,
          nextPageBlocks: nextBlocks,
          prevPageLayoutBlocks: currentPage.layoutBlocks,
          nextPageLayoutBlocks: nextPage.layoutBlocks,
        });
        if (evalNext.shouldMerge && evalNext.mergedText) {
          currBlocks[lastCurrIdx] = evalNext.mergedText;
        }
      }
    }

    return currBlocks.join('\n\n');
  }, [markdown, currentPage, pages, conversionSettings.smartSpacing]);

  // Convert markdown to preview HTML with actual figure image resolution and interactive TOC links
  const previewHtml = markdownToXhtml(previewMarkdown, currentPage.figures || [], {
    isPreview: true,
    pageNumber: currentPage.pageNumber,
    isTocPage: isLikelyTocPage(currentPage, pages),
    allPages: pages,
  });

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const pageAttr = target.getAttribute('data-target-page');
    const anchorAttr = target.getAttribute('data-anchor');
    const href = target.getAttribute('href') || '';
    const anchorFromHref = href.includes('#') ? href.split('#')[1] : null;
    const anchorId = anchorAttr || anchorFromHref;

    let targetPageNum: number | null = null;
    if (pageAttr) {
      targetPageNum = parseInt(pageAttr, 10);
    } else {
      const match = href.match(/page_(\d+)\.xhtml/);
      if (match) targetPageNum = parseInt(match[1], 10);
    }

    if (targetPageNum !== null && onSelectPage) {
      e.preventDefault();
      const targetIdx = pages.findIndex((p) => p.pageNumber === targetPageNum);
      if (targetIdx !== -1) {
        onSelectPage(targetIdx);

        if (anchorId) {
          setTimeout(() => {
            const anchorEl = document.getElementById(anchorId);
            if (anchorEl) {
              anchorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              anchorEl.classList.add('bg-amber-100', 'dark:bg-amber-950/50', 'transition-colors', 'duration-500');
              setTimeout(() => {
                anchorEl.classList.remove('bg-amber-100', 'dark:bg-amber-950/50');
              }, 1500);
            }
          }, 150);
        }
      }
    }
  };

  // Font size classes
  const fontClasses = {
    sm: 'text-sm leading-relaxed',
    base: 'text-[15px] sm:text-[16px] leading-[1.85]',
    lg: 'text-[17px] sm:text-[18px] leading-[1.95]',
  }[fontSize];

  return (
    <div
      id="right-panel-container"
      style={{
        maxWidth: '100%',
        ...(width ? ({ '--editor-width': `${width}px` } as React.CSSProperties) : {}),
      }}
      className="w-full lg:w-[var(--editor-width,560px)] flex-shrink-0 flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xs z-20 overflow-hidden select-text transition-colors"
    >
      {/* Top Header & Navigation Tabs */}
      <div className="p-2 sm:p-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        {/* View Mode Tabs: Preview is Primary & Default */}
        <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'preview'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>ইপাব প্রিভিউ</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'editor'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>এডিটর</span>
          </button>

          {/* Split View Tab */}
          <button
            type="button"
            onClick={() => setActiveTab('split')}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all ${
              activeTab === 'split'
                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            title="এডিটর এবং প্রিভিউ একসাথে দেখুন"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>স্প্লিট</span>
          </button>

          {currentPage.figures?.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('figures')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all ${
                activeTab === 'figures'
                  ? 'bg-white text-purple-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>ছবি ({currentPage.figures.length})</span>
            </button>
          )}
        </div>

        {/* Font Size & Tool Actions */}
        <div className="flex items-center gap-1.5">
          {/* Reader Theme Selector (When in Preview) */}
          {activeTab === 'preview' && (
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 text-[10px] font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setReaderTheme('paper')}
                className={`px-1.5 py-1 rounded transition-colors ${
                  readerTheme === 'paper' ? 'bg-[#fcf8ee] text-[#78350f] font-bold shadow-2xs' : 'hover:text-slate-900'
                }`}
                title="কাগজের রঙ (বইয়ের মতো)"
              >
                কাগজ
              </button>
              <button
                type="button"
                onClick={() => setReaderTheme('clean')}
                className={`px-1.5 py-1 rounded transition-colors ${
                  readerTheme === 'clean' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'hover:text-slate-900'
                }`}
                title="সাদা ব্যাকগ্রাউন্ড"
              >
                সাদা
              </button>
              <button
                type="button"
                onClick={() => setReaderTheme('sepia')}
                className={`px-1.5 py-1 rounded transition-colors ${
                  readerTheme === 'sepia' ? 'bg-[#e2d5bc] text-[#451a03] font-bold shadow-2xs' : 'hover:text-slate-900'
                }`}
                title="সেপিয়া মোড"
              >
                সেপিয়া
              </button>
              <button
                type="button"
                onClick={() => setReaderTheme('night')}
                className={`px-1.5 py-1 rounded transition-colors ${
                  readerTheme === 'night' ? 'bg-slate-800 text-amber-200 font-bold shadow-2xs' : 'hover:text-slate-900'
                }`}
                title="নাইট মোড"
              >
                ডার্ক
              </button>
            </div>
          )}

          {/* Font Size Controller */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 text-[11px] font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setFontSize('sm')}
              className={`px-1.5 py-1 rounded ${fontSize === 'sm' ? 'bg-white text-indigo-600 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              title="ছোট ফন্ট"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setFontSize('base')}
              className={`px-1.5 py-1 rounded ${fontSize === 'base' ? 'bg-white text-indigo-600 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              title="স্বাভাবিক ফন্ট"
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFontSize('lg')}
              className={`px-1.5 py-1 rounded ${fontSize === 'lg' ? 'bg-white text-indigo-600 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              title="বড় ফন্ট"
            >
              A+
            </button>
          </div>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 border border-slate-200/80 transition-colors"
            title="মার্কডাউন কপি করুন"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Reset to OCR Button */}
          {currentPage.originalOcr && (
            <button
              type="button"
              onClick={onResetToOcr}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-slate-100 border border-slate-200/80 transition-colors"
              title="এআই মূল ওসিআরে রিসেট করুন"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Manual Error Notice Bar (Purely Manual, Auto-rescan removed!) */}
      {currentPage.status === 'error' && (
        <div className="bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-800 px-3.5 py-2.5 flex items-center justify-between gap-2.5 text-xs flex-shrink-0">
          <div className="flex items-start gap-2 text-rose-800 dark:text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold text-rose-900 dark:text-rose-100">এই পৃষ্ঠায় রূপান্তর ত্রুটি হয়েছে</div>
              <div className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug mt-0.5">
                {formatFriendlyErrorMessage(currentPage.errorMsg)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRescanPage(currentPageIndex)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>রিস্ক্যান করুন</span>
          </button>
        </div>
      )}

      {/* Skipped Page Banner */}
      {currentPage.status === 'excluded' && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800/80 px-3.5 py-2 flex items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <span className="font-semibold">⚠️ পৃষ্ঠা {currentPage.pageNumber} স্কিপ করা হয়েছে (রূপান্তর ও ইপাবে যুক্ত হবে না)।</span>
          </div>
          {onToggleExclude && (
            <button
              type="button"
              onClick={() => onToggleExclude(currentPageIndex)}
              className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs"
            >
              আন-স্কিপ করুন
            </button>
          )}
        </div>
      )}

      {/* Unicode Script & Low-Confidence OCR Review Banner */}
      {(hasAutoFixableScriptErrors || activeFlaggedTokens.length > 0) && (
        <div className="bg-amber-50/90 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800/70 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="truncate">
              {hasAutoFixableScriptErrors
                ? 'সন্দেহজনক মিশ্র-লিপি (Mixed-Script) অক্ষর শনাক্ত হয়েছে।'
                : `পর্যালোচনার জন্য চিহ্নিত সন্দেহজনক শব্দ (${activeFlaggedTokens.length}টি): ${activeFlaggedTokens
                    .slice(0, 3)
                    .map((f) => `"${f.token}"`)
                    .join(', ')}`}
            </span>
          </div>
          {hasAutoFixableScriptErrors && (
            <button
              type="button"
              onClick={() => onUpdateMarkdown(liveValidation.correctedText)}
              className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs flex-shrink-0 cursor-pointer"
            >
              ইউনিকোড সংশোধন করুন
            </button>
          )}
        </div>
      )}

      {/* Formatting Toolbar */}
      {(activeTab === 'editor' || activeTab === 'split') && (
        <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center flex-wrap gap-1 text-slate-600 dark:text-slate-300 flex-shrink-0">
          <button
            type="button"
            onClick={() => handleInsertSyntax('# ', '')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
            title="শিরোনাম ১ (H1)"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('## ', '')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
            title="শিরোনাম ২ (H2)"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('### ', '')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
            title="শিরোনাম ৩ (H3)"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <button
            type="button"
            onClick={() => handleInsertSyntax('**', '**')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
            title="বোল্ড (**লেখা**)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('*', '*')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs italic"
            title="ইটালিক (*লেখা*)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('> ', '')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
            title="উদ্ধৃতি বা স্তবক"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
          {/* Alignment Tools */}
          <button
            type="button"
            onClick={() => handleInsertSyntax('<p class="text-left">', '</p>')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
            title="লেফট অ্যালাইন (বাম প্রান্তে সাজান)"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('<p class="text-center">', '</p>')}
            className="p-1.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold text-xs"
            title="সেন্টার অ্যালাইন (মাঝখানে সাজান - কবিতা, শিরোনাম, বিভাগ)"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('<p class="text-right">', '</p>')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
            title="রাইট অ্যালাইন (ডান প্রান্তে সাজান - স্বাক্ষর, স্থান, তারিখ)"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('<p class="indent-1">', '</p>')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
            title="বেসিক ইনডেন্টেশন (শুরুতে ইনডেন্ট স্পেস দিন)"
          >
            <Indent className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('\n<p class="text-center">* * *</p>\n')}
            className="px-1.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-300"
            title="সেন্টার সেকশন বিভাজক (* * *)"
          >
            * * *
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <button
            type="button"
            onClick={() => handleInsertSyntax('- ', '')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
            title="তালিকা (- আইটেম)"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('\n---\n')}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
            title="বিভাজক রেখা"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleInsertSyntax('\n[^১]: ', 'পাদটীকা')}
            className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300"
            title="পাদটীকা"
          >
            [^১]
          </button>
          <button
            type="button"
            onClick={() =>
              handleInsertSyntax('\n[IMAGE_FIGURE: {"type": "illustration"}]\n')
            }
            className="px-2 py-1 rounded hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-700 dark:text-purple-300 text-[11px] font-semibold flex items-center gap-1 ml-auto"
            title="ছবির ট্যাগ যোগ করুন"
          >
            <ImageIcon className="w-3 h-3" />
            <span>+ছবি</span>
          </button>
        </div>
      )}

      {/* Vertically Resizable Upper Section: Editor / Preview */}
      <div
        className="flex flex-col min-h-[160px] overflow-hidden flex-1 lg:flex-initial"
        style={{
          height: isDesktop
            ? (isMonitorExpanded ? `${editorHeight}px` : 'calc(100% - 46px)')
            : undefined,
        }}
      >
        {/* Main Content Area (Scrollable / Expandable Editor & Preview) */}
        <div className="flex-1 overflow-hidden p-3 flex flex-col min-h-0">
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col h-full min-h-0">
              <textarea
                id="markdown-textarea"
                value={markdown}
                onChange={(e) => onUpdateMarkdown(e.target.value)}
                placeholder="জেমিনাই ভিশন এআই থেকে এক্সট্রাক্ট করা বাংলা টেক্সট এখানে প্রদর্শিত হবে। আপনি চাইলে সরাসরি যেকোনো শব্দ বা ফরম্যাটিং এডিট করতে পারেন..."
                className={`flex-1 w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 bg-slate-50/40 dark:bg-slate-800/90 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans resize-none transition-all shadow-inner placeholder:text-slate-400 dark:placeholder:text-slate-400 ${fontClasses} h-full min-h-[160px]`}
              />
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="flex-1 overflow-hidden flex flex-col h-full min-h-0">
              {/* Bengali Book Reader Top Subheader */}
              <div className="flex items-center justify-between pb-2 px-1 text-xs text-slate-500 border-b border-slate-100 mb-2 flex-shrink-0">
                <div className="flex items-center gap-1.5 font-medium">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="font-semibold text-slate-700">বইয়ের বাস্তবসম্মত ইপাব রূপ</span>
                  {currentPage.figures?.length > 0 && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                      {currentPage.figures.length}টি চিত্র সংযুক্ত
                    </span>
                  )}
                </div>

                {/* Font family selection */}
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-slate-400">ফন্ট:</span>
                  <button
                    type="button"
                    onClick={() => setReaderFont('noto')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      readerFont === 'noto'
                        ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                    title="Google Noto Sans Bengali"
                  >
                    নাতো সানস
                  </button>
                  <button
                    type="button"
                    onClick={() => setReaderFont('kalpurush')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      readerFont === 'kalpurush'
                        ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    কালপুরুষ
                  </button>
                  <button
                    type="button"
                    onClick={() => setReaderFont('solaiman')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      readerFont === 'solaiman'
                        ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    সুলাইমান
                  </button>
                  <button
                    type="button"
                    onClick={() => setReaderFont('siliguri')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      readerFont === 'siliguri'
                        ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    সিলিগুড়ি
                  </button>
                </div>
              </div>

              {/* Reader Paper Body */}
              <div
                className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 rounded-xl border shadow-xs transition-colors ${
                  readerTheme === 'paper'
                    ? 'bg-[#fcf8ee] text-[#221c15] border-[#eadfc9]'
                    : readerTheme === 'sepia'
                    ? 'bg-[#f4ecd8] text-[#433422] border-[#dfd2b5]'
                    : readerTheme === 'night'
                    ? 'bg-slate-900 text-slate-100 border-slate-800'
                    : 'bg-white text-slate-800 border-slate-200'
                }`}
                style={{
                  fontFamily:
                    readerFont === 'noto'
                      ? '"Noto Sans Bengali", sans-serif'
                      : readerFont === 'kalpurush'
                      ? '"Kalpurush", serif'
                      : readerFont === 'solaiman'
                      ? '"SolaimanLipi", serif'
                      : '"Hind Siliguri", sans-serif',
                }}
              >
                {markdown.trim() ? (
                  <div
                    onClick={handlePreviewClick}
                    className={`prose max-w-none text-justify ${fontClasses} ${
                      readerTheme === 'night' ? 'prose-invert text-slate-100' : 'text-inherit'
                    }`}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center py-8">
                    <BookOpen className="w-10 h-10 mb-2 text-slate-300 stroke-[1.5]" />
                    <p className="font-semibold text-slate-600 text-sm">পৃষ্ঠা {currentPage.pageNumber} এখনো রূপান্তর হয়নি</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs leading-relaxed">
                      নিচের লাইভ মনিটর থেকে "সব পাতা রূপান্তর" অথবা উপরের বাম মেনু থেকে ওসিআর চালু করুন।
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'split' && (
            <div className="flex-1 flex flex-col gap-2.5 h-full min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-h-0">
                <textarea
                  id="markdown-textarea"
                  value={markdown}
                  onChange={(e) => onUpdateMarkdown(e.target.value)}
                  placeholder="বাংলা টেক্সট লিখুন..."
                  className={`flex-1 w-full p-3 rounded-xl border border-slate-200 text-slate-800 bg-slate-50/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans resize-none transition-all shadow-inner ${fontClasses} h-full min-h-[100px]`}
                />
              </div>
              <div
                className={`flex-1 overflow-y-auto p-3.5 rounded-xl border shadow-inner h-full min-h-[100px] ${
                  readerTheme === 'paper'
                    ? 'bg-[#fcf8ee] text-[#221c15] border-[#eadfc9]'
                    : readerTheme === 'night'
                    ? 'bg-slate-900 text-slate-100 border-slate-800'
                    : 'bg-white text-slate-800 border-slate-200'
                }`}
              >
                {markdown.trim() ? (
                  <div
                    onClick={handlePreviewClick}
                    className={`prose max-w-none text-slate-800 ${fontClasses}`}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    প্রিভিউ কন্টেন্ট নেই
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'figures' && (
            <div className="flex-1 overflow-y-auto space-y-3 h-full min-h-[160px]">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                এই পাতায় শনাক্তকৃত চিত্র ({currentPage.figures.length} টি):
              </div>
              {currentPage.figures.map((fig, idx) => (
                <div key={idx} className="p-3 bg-purple-50/70 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-purple-900 dark:text-purple-200">
                    <span className="flex items-center gap-1.5">
                      <span>চিত্র #{idx + 1}</span>
                      {fig.align && (
                        <span className="text-[10px] font-normal bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-1.5 py-0.2 rounded border border-purple-200 dark:border-purple-800">
                          {fig.align === 'left' ? 'বামে' : fig.align === 'right' ? 'ডানে' : 'কেন্দ্রে'}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] bg-purple-200 dark:bg-purple-900/80 text-purple-800 dark:text-purple-300 px-2 py-0.5 rounded font-mono font-semibold">
                      {fig.type || 'figure'}
                    </span>
                  </div>
                  {fig.imageUrl && (
                    <img
                      src={fig.imageUrl}
                      alt="চিত্র"
                      className="w-full h-auto rounded-lg border border-purple-300 dark:border-purple-800 object-contain max-h-48 bg-white dark:bg-slate-900"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Editor Word Count & Status Strip */}
        <div className="px-3.5 py-1.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-[11px] text-slate-500 font-mono flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span>
              শব্দ: <strong className="text-slate-800 font-bold">{wordCount}</strong>
            </span>
            <span>•</span>
            <span>
              অক্ষর: <strong className="text-slate-800 font-bold">{charCount}</strong>
            </span>
            <span>•</span>
            <span>
              লাইন: <strong className="text-slate-800 font-bold">{lineCount}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-600">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>~{readMinutes} মিনিট পঠন</span>
          </div>
        </div>
      </div>

      {/* Vertical Drag Resizer Bar between Editor and Live Monitor (Desktop only) */}
      {isMonitorExpanded && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDraggingHeight(true);
          }}
          onDoubleClick={() => {
            setEditorHeight(460);
            try {
              localStorage.setItem('bangla_epub_editor_height', '460');
            } catch {}
          }}
          className="hidden lg:flex h-2.5 w-full bg-slate-100 hover:bg-indigo-100 active:bg-indigo-300 cursor-row-resize items-center justify-center transition-colors border-y border-slate-200 select-none group relative z-10 flex-shrink-0"
          title="উচ্চতা পরিবর্তন করতে ড্র্যাগ করুন (ডাবল-ক্লিক করলে রিসেট হবে)"
        >
          <div className="w-12 h-1 bg-slate-300 group-hover:bg-indigo-600 rounded-full transition-colors" />
        </div>
      )}

      {/* ========================================================================= */}
      {/* LIVE PROCESS MONITOR (RELOCATED TO RIGHT PANEL BENEATH MARKDOWN EDITOR) */}
      {/* ========================================================================= */}
      <div
        className={`border-t border-indigo-500/20 bg-slate-50/95 flex flex-col shadow-lg transition-all ${
          isMonitorExpanded ? 'flex-1 min-h-[140px] overflow-hidden' : 'flex-shrink-0'
        }`}
      >
        {/* Monitor Header with Toggle and Quick Info */}
        <div className="px-3.5 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  processingState.isConverting ? 'bg-rose-400' : 'bg-emerald-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  processingState.isConverting ? 'bg-rose-600' : 'bg-emerald-600'
                }`}
              />
            </span>
            <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
              <span>লাইভ প্রসেসিং মনিটর</span>
              <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full font-mono">
                {progressPercentage}%
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Live Elapsed Scanning Timer Badge */}
            {(processingState.isConverting || elapsedSeconds > 0) && (
              <span className="text-[10px] sm:text-[11px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded-full font-mono font-bold flex items-center gap-1 shadow-2xs">
                <Clock className={`w-3 h-3 ${processingState.isConverting ? 'text-indigo-600 animate-spin' : 'text-slate-400'}`} />
                <span>{formatElapsedTime(elapsedSeconds)}</span>
              </span>
            )}

            {/* Go Live / Live Auto-Follow Button */}
            {processingState.isConverting && processingState.currentPageNumber !== null && (
              isLiveTracking ? (
                <button
                  type="button"
                  onClick={onToggleLiveTracking ? onToggleLiveTracking : onGoLive}
                  className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs flex items-center gap-1 transition-all cursor-pointer"
                  title="লাইভ অটো-ফলো চালু রয়েছে (প্রতিটি নতুন পাতায় স্বয়ংক্রিয়ভাবে যাবে)। ক্লিক করে পজ করুন।"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  <Radio className="w-3 h-3" />
                  <span>লাইভ ফলো ({processingState.currentPageNumber})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onGoLive}
                  className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-bold bg-rose-600 text-white hover:bg-rose-700 shadow-2xs flex items-center gap-1 animate-pulse transition-all cursor-pointer"
                  title="বর্তমানে প্রসেস হতে থাকা পাতায় যান এবং অটো-ফলো চালু করুন"
                >
                  <Radio className="w-3 h-3" />
                  <span>গো লাইভ ({processingState.currentPageNumber})</span>
                </button>
              )
            )}

            {/* Collapse/Expand Toggle */}
            <button
              type="button"
              onClick={() => setIsMonitorExpanded(!isMonitorExpanded)}
              className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              title={isMonitorExpanded ? 'মনিটর সংকুচিত করুন' : 'মনিটর বিস্তারিত দেখুন'}
            >
              {isMonitorExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Monitor Body (Collapsible) */}
        {isMonitorExpanded && (
          <div className="p-3 space-y-2.5 max-h-[340px] overflow-y-auto">
            {/* Overall Book Progress Bar */}
            <div className="space-y-1.5 bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>বইয়ের মোট রূপান্তর অগ্রগতি:</span>
                </div>
                <div className="font-extrabold text-indigo-700 font-mono">
                  {completedCount} / {totalEligible} পাতা ({progressPercentage}%)
                </div>
              </div>

              {/* Progress Bar (Clamped strictly to 100%) */}
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden relative p-0.5 shadow-inner">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {/* Milestone ticks */}
              <div className="flex justify-between text-[9px] font-mono text-slate-400 px-0.5">
                <span>০%</span>
                <span>২৫%</span>
                <span>৫০%</span>
                <span>৭৫%</span>
                <span>১০০%</span>
              </div>

              {/* Stats badges */}
              <div className="flex items-center flex-wrap gap-2 text-[10.5px] text-slate-600 font-medium pt-0.5">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  <span>সম্পন্ন: <strong className="text-slate-900">{completedCount}</strong></span>
                </span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>অবশিষ্ট: <strong className="text-slate-900">{Math.max(0, totalEligible - completedCount)}</strong></span>
                </span>
                <span className="text-slate-300">•</span>
                <span>মোট: <strong className="text-slate-900">{totalPages}</strong></span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                  <Clock className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  <span>ব্যয়িত সময়: {formatElapsedTime(elapsedSeconds)} {elapsedSeconds > 60 ? `(${formatBengaliDuration(elapsedSeconds)})` : ''}</span>
                </span>
                {errorCount > 0 && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                      ত্রুটি: {errorCount}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions & Batch Size Controls */}
            <div className="flex flex-col gap-2 pt-1">
              {/* Extraction Mode Selector */}
              {onChangeMode && (
                <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs shadow-2xs">
                  <span className="text-[10.5px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-indigo-500" />
                    রূপান্তর মোড:
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onChangeMode('smart')}
                      disabled={processingState.isConverting}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                        conversionSettings.mode === 'smart'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title="স্মার্ট অটো: প্রয়োজনীয় টেক্সট ও ছবি/লোগো স্বয়ংক্রিয়ভাবে শনাক্ত ও ক্রপ করবে"
                    >
                      ⚡ স্মার্ট অটো
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeMode('image')}
                      disabled={processingState.isConverting}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                        conversionSettings.mode === 'image'
                          ? 'bg-purple-600 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title="চিত্র সহ: বইয়ের চিত্র ও ডায়াগ্রামগুলো ক্রপ করে পাতায় যুক্ত করবে"
                    >
                      🖼️ চিত্র সহ
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeMode('text')}
                      disabled={processingState.isConverting}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                        conversionSettings.mode === 'text'
                          ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title="শুধু টেক্সট: চিত্র ছাড়া শুধুই টেক্সট"
                    >
                      📝 শুধু টেক্সট
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Batch Size Selector */}
                <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs shadow-2xs max-w-full overflow-x-auto no-scrollbar">
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 px-1 whitespace-nowrap flex-shrink-0">
                    একত্রে:
                  </span>
                  <div className="flex items-center gap-0.5 flex-nowrap flex-shrink-0">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => onChangeBatchSize(num)}
                        disabled={processingState.isConverting}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all flex-shrink-0 ${
                          conversionSettings.batchSize === num
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50'
                        }`}
                        title={`একসাথে ${num}টি পৃষ্ঠা ওসিআর`}
                      >
                        {num}
                      </button>
                    ))}
                    <span className="text-[9px] text-slate-400 px-0.5 flex-shrink-0">পাতা</span>
                  </div>
                </div>

                {/* Convert All / Pause / Rescan All Errors */}
                <div className="flex items-center gap-1.5">
                  {/* Rescan All Errors Button */}
                  {errorCount > 0 && (
                    <button
                      type="button"
                      onClick={onRescanErrors}
                      disabled={processingState.isConverting}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors"
                      title="সবগুলো ত্রুটিপূর্ণ পাতা একসাথে পুনরায় স্ক্যান করুন"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      <span>{errorCount}টি ত্রুটি রিস্ক্যান</span>
                    </button>
                  )}

                  {processingState.isConverting ? (
                    <button
                      type="button"
                      onClick={onPauseConversion}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>বিরতি দিন</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onStartConversion}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs shadow-indigo-200 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>সব পাতা রূপান্তর</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Visual Step Indicator Badges (4 Steps) */}
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {/* Step 1 */}
              <div
                className={`p-1.5 rounded-lg border text-[10px] ${
                  processingState.isConverting && processingState.currentPhase === 'rendering'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 font-bold ring-1 ring-indigo-400'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="font-semibold truncate">১. বিশ্লেষণ</div>
              </div>

              {/* Step 2 */}
              <div
                className={`p-1.5 rounded-lg border text-[10px] ${
                  processingState.isConverting && processingState.currentPhase === 'ocr'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold ring-1 ring-purple-400 animate-pulse'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="font-semibold truncate">২. ভিশন OCR</div>
              </div>

              {/* Step 3 */}
              <div
                className={`p-1.5 rounded-lg border text-[10px] ${
                  processingState.isConverting && processingState.currentPhase === 'image_detect'
                    ? 'border-fuchsia-600 bg-fuchsia-50 text-fuchsia-900 font-bold ring-1 ring-fuchsia-400 animate-pulse'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="font-semibold truncate">৩. চিত্র/ছবি</div>
              </div>

              {/* Step 4 */}
              <div
                className={`p-1.5 rounded-lg border text-[10px] ${
                  currentPage.status === 'completed'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold'
                    : currentPage.status === 'error'
                    ? 'border-rose-400 bg-rose-50 text-rose-900 font-bold'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="font-semibold truncate">৪. মার্কডাউন</div>
              </div>
            </div>

            {/* Recent Log Message */}
            {processingState.logMessages.length > 0 && (
              <div className="text-[10.5px] font-mono text-slate-600 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center justify-between gap-1 shadow-2xs">
                <span className="truncate">
                  {processingState.logMessages[processingState.logMessages.length - 1]}
                </span>
                {canGoLive && (
                  <button
                    type="button"
                    onClick={onGoLive}
                    className="text-rose-600 hover:underline font-bold text-[10px] flex-shrink-0"
                  >
                    লাইভ →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Made with ❤️ Footer Attribution */}
      <div className="py-2 px-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 select-none">
        <span>Made with ❤️ by </span>
        <a
          href="https://facebook.com/srsetu"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline inline-flex items-center gap-1 transition-colors"
        >
          সাইদুর রহমান সেতু
        </a>
      </div>
    </div>
  );
};
