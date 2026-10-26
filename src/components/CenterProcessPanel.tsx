import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PageItem, ProcessingState, ConversionSettings, ExtractionMode } from '../types';
import { formatFriendlyErrorMessage } from '../utils/errorHelper';
import { formatElapsedTime } from '../utils/timeHelper';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Radio,
  AlertTriangle,
  SkipForward,
  Trash2,
  ScrollText,
  FileText,
  Maximize2,
  CheckCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface CenterProcessPanelProps {
  currentPage: PageItem | null;
  currentPageIndex: number;
  totalPages: number;
  processingState: ProcessingState;
  conversionSettings: ConversionSettings;
  errorCount: number;
  pages?: PageItem[];
  onSelectPage?: (pageIndex: number) => void;
  onStartConversion: () => void;
  onPauseConversion: () => void;
  onProcessSinglePage: (pageIndex: number) => void;
  onRescanPage: (pageIndex: number) => void;
  onRescanErrors: () => void;
  onGoLive: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onChangeBatchSize: (size: number) => void;
  onToggleExclude?: (pageIndex: number) => void;
  onDeletePage?: (pageIndex: number) => void;
  onChangeMode?: (mode: ExtractionMode) => void;
  elapsedSeconds?: number;
  isLiveTracking?: boolean;
  onToggleLiveTracking?: () => void;
}

export const CenterProcessPanel: React.FC<CenterProcessPanelProps> = ({
  currentPage,
  currentPageIndex,
  totalPages,
  processingState,
  conversionSettings,
  errorCount,
  pages,
  onSelectPage,
  onStartConversion,
  onPauseConversion,
  onProcessSinglePage,
  onRescanPage,
  onRescanErrors,
  onGoLive,
  onPrevPage,
  onNextPage,
  onChangeBatchSize,
  onToggleExclude,
  onDeletePage,
  onChangeMode,
  elapsedSeconds = 0,
  isLiveTracking = false,
  onToggleLiveTracking,
}) => {
  const [zoom, setZoom] = useState<number>(100);
  const [isContinuousView, setIsContinuousView] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('bangla_epub_continuous_view');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const isUserScrollingRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLiveTrackingRef = useRef<boolean>(isLiveTracking);

  useEffect(() => {
    isLiveTrackingRef.current = isLiveTracking;
  }, [isLiveTracking]);

  const handleToggleContinuousView = () => {
    const nextVal = !isContinuousView;
    setIsContinuousView(nextVal);
    try {
      localStorage.setItem('bangla_epub_continuous_view', String(nextVal));
    } catch {}
  };

  // Scroll active page into view when selected externally or via live tracking
  useEffect(() => {
    if (!currentPage) return;
    if (isUserScrollingRef.current && !isLiveTracking) return;

    if (isContinuousView) {
      const el = document.getElementById(`pdf-page-${currentPage.pageNumber}`);
      if (el && scrollContainerRef.current) {
        isProgrammaticScrollRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scrollTimeoutRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 750);
      }
    } else {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [currentPageIndex, isContinuousView, currentPage?.pageNumber, isLiveTracking]);

  // Sync scroll position in continuous view to update active page (ONLY during manual scroll when NOT live-tracking)
  const handleScroll = useCallback(() => {
    // If live tracking is active or programmatic scroll is underway, NEVER let handleScroll hijack onSelectPage
    if (isLiveTrackingRef.current || isProgrammaticScrollRef.current) {
      return;
    }
    if (!isContinuousView || !pages || pages.length === 0 || !scrollContainerRef.current) return;

    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 400);

    const container = scrollContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerCenterY = containerRect.top + containerRect.height / 2;

    let closestIdx = currentPageIndex;
    let minDistance = Infinity;

    pages.forEach((page, idx) => {
      const el = document.getElementById(`pdf-page-${page.pageNumber}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const cardCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(cardCenterY - containerCenterY);
        if (distance < minDistance) {
          minDistance = distance;
          closestIdx = idx;
        }
      }
    });

    if (closestIdx !== currentPageIndex && onSelectPage) {
      onSelectPage(closestIdx);
    }
  }, [isContinuousView, pages, currentPageIndex, onSelectPage]);

  if (!currentPage) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950 text-slate-400 text-sm">
        কোনো পৃষ্ঠা নির্বাচিত নেই
      </div>
    );
  }

  const isCurrentPageProcessing =
    processingState.isConverting && processingState.currentPageNumber === currentPage.pageNumber;

  const isLivePage =
    processingState.isConverting && processingState.currentPageNumber === currentPage.pageNumber;

  const canGoLive =
    processingState.isConverting &&
    processingState.currentPageNumber !== null &&
    processingState.currentPageNumber !== currentPage.pageNumber;

  // Helper to render bounding boxes for figures
  const renderFigures = (page: PageItem) => {
    if (!page.figures || page.figures.length === 0) return null;
    return page.figures.map((fig, idx) => (
      <div
        key={idx}
        className={`absolute border-2 border-dashed rounded-md pointer-events-none flex items-start justify-end p-1 transition-all ${
          fig.type === 'icon'
            ? 'border-amber-500 bg-amber-500/15'
            : 'border-purple-500 bg-purple-500/15'
        }`}
        style={{
          top: `${fig.top ?? 25}%`,
          left: `${fig.left ?? 10}%`,
          width: `${fig.width ?? 80}%`,
          height: `${fig.height ?? 30}%`,
        }}
      >
        <span
          className={`text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs ${
            fig.type === 'icon' ? 'bg-amber-600' : 'bg-purple-600'
          }`}
        >
          {fig.type === 'icon' ? 'আইকন/লোগো' : fig.caption || 'চিত্র'}
        </span>
      </div>
    ));
  };

  // Helper to render page banner overlays
  const renderBanners = (page: PageItem, idx: number) => {
    return (
      <>
        {page.status === 'excluded' && (
          <div className="absolute inset-x-4 top-4 bg-amber-900/95 backdrop-blur-xs text-white p-3 rounded-xl border border-amber-500 shadow-xl flex items-center justify-between gap-3 z-30">
            <div className="flex items-center gap-2 text-xs">
              <SkipForward className="w-4 h-4 text-amber-300 flex-shrink-0" />
              <div>
                <div className="font-bold text-xs sm:text-sm">এই পৃষ্ঠাটি স্কিপ করা হয়েছে</div>
                <div className="text-[10px] sm:text-[11px] text-amber-200 leading-snug">
                  রূপান্তর ও ইপাব বই থেকে বাদ থাকবে।
                </div>
              </div>
            </div>
            {onToggleExclude && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExclude(idx);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-amber-900 hover:bg-amber-100 shadow-xs flex-shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>আন-স্কিপ</span>
              </button>
            )}
          </div>
        )}

        {page.status === 'error' && (
          <div className="absolute inset-x-4 top-4 bg-rose-900/95 backdrop-blur-xs text-white p-3 rounded-xl border border-rose-500 shadow-xl flex items-center justify-between gap-3 z-30">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-300 flex-shrink-0" />
              <div>
                <div className="font-bold text-xs sm:text-sm">রূপান্তর ত্রুটি ঘটেছে!</div>
                <div className="text-[10px] sm:text-[11px] text-rose-200 leading-snug line-clamp-2">
                  {formatFriendlyErrorMessage(page.errorMsg)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRescanPage(idx);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-rose-700 hover:bg-rose-50 shadow-xs flex-shrink-0"
            >
              <RotateCw className="w-3 h-3" />
              <span>রিস্ক্যান</span>
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex-1 min-w-0 w-full min-h-0 flex flex-col h-full bg-slate-100/70 dark:bg-slate-950/60 overflow-hidden relative transition-colors">
      {/* Top Controls Bar for PDF Viewer */}
      <div className="h-auto min-h-[3.5rem] py-2 px-3 sm:px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 shadow-2xs z-10 flex-shrink-0">
        {/* Left: Page Navigation & Go Live Button */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPageIndex <= 0}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
            title="পূর্ববর্তী পৃষ্ঠা"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
            পৃষ্ঠা {currentPage.pageNumber}{' '}
            <span className="text-slate-400 dark:text-slate-500 font-normal">/ {totalPages}</span>
          </div>
          <button
            type="button"
            onClick={onNextPage}
            disabled={currentPageIndex >= totalPages - 1}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
            title="পরবর্তী পৃষ্ঠা"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Go Live / Live Auto-Follow Button */}
          {processingState.isConverting && processingState.currentPageNumber !== null && (
            isLiveTracking ? (
              <button
                type="button"
                onClick={onToggleLiveTracking ? onToggleLiveTracking : onGoLive}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-950 transition-all cursor-pointer"
                title="লাইভ অটো-ফলো চালু রয়েছে (প্রতিটি নতুন পাতা এলে স্বয়ংক্রিয়ভাবে শিফট হবে)। ক্লিক করে পজ করুন।"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                <Radio className="w-3.5 h-3.5" />
                <span>লাইভ ফলো চালু ({processingState.currentPageNumber})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onGoLive}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-200 dark:shadow-rose-950 animate-pulse transition-all cursor-pointer"
                title="বর্তমানে যে পাতা প্রসেস হচ্ছে সেখানে যান এবং অটো-ফলো চালু করুন"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>গো লাইভ ({processingState.currentPageNumber})</span>
              </button>
            )
          )}
        </div>

          {/* Center: View Mode Toggle & Elapsed Scanning Timer */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Elapsed Scanning Timer Badge */}
          {(processingState.isConverting || elapsedSeconds > 0) && (
            <div
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all ${
                processingState.isConverting
                  ? 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
              title="মোট স্ক্যানিং ব্যয়িত সময়"
            >
              <Clock className={`w-3.5 h-3.5 ${processingState.isConverting ? 'text-rose-600 animate-spin' : 'text-slate-400'}`} />
              <span>{formatElapsedTime(elapsedSeconds)}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleToggleContinuousView}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold transition-all border ${
              isContinuousView
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 shadow-2xs font-bold'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
            }`}
            title={
              isContinuousView
                ? 'ধারাবাহিক স্ক্রল সক্রিয়: সব পাতা এক সাথে স্ক্রল করতে পারবেন। ক্লিক করে একক পৃষ্ঠা ভিউতে যান।'
                : 'একক পাতা ভিউ সক্রিয়। ক্লিক করে সব পাতা ধারাবাহিক স্ক্রলে দেখতে যান।'
            }
          >
            {isContinuousView ? (
              <>
                <ScrollText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden xs:inline">ধারাবাহিক </span>
                <span>স্ক্রল</span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden xs:inline">একক </span>
                <span>পাতা</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Actions & Zoom Controls */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Skip / Unskip Page Button */}
          {onToggleExclude && (
            <button
              type="button"
              onClick={() => onToggleExclude(currentPageIndex)}
              className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-lg text-xs sm:text-sm font-semibold transition-colors shadow-2xs ${
                currentPage.status === 'excluded'
                  ? 'border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-750'
              }`}
              title={
                currentPage.status === 'excluded'
                  ? 'পৃষ্ঠাটি রূপান্তরে পুনরায় অন্তর্ভুক্ত করুন (আন-স্কিপ)'
                  : 'এই পৃষ্ঠাটি রূপান্তরে স্কিপ করুন (ইপাবে বাদ পড়বে)'
              }
            >
              {currentPage.status === 'excluded' ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>আন-স্কিপ</span>
                </>
              ) : (
                <>
                  <SkipForward className="w-3.5 h-3.5 text-amber-500" />
                  <span className="hidden xs:inline">স্কিপ পাতা</span>
                  <span className="xs:hidden">স্কিপ</span>
                </>
              )}
            </button>
          )}

          {/* Delete Page Button */}
          {onDeletePage && (
            <button
              type="button"
              onClick={() => onDeletePage(currentPageIndex)}
              disabled={processingState.isConverting}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-lg text-xs sm:text-sm font-semibold transition-colors border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 shadow-2xs disabled:opacity-50"
              title="এই পৃষ্ঠাটি সম্পূর্ণরূপে মুছে ফেলুন"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>মুছুন</span>
            </button>
          )}

          {/* Extraction Mode Quick Switcher */}
          {onChangeMode && (
            <div className="hidden sm:flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/80 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => onChangeMode('smart')}
                disabled={processingState.isConverting}
                className={`px-2 py-1 rounded transition-all flex items-center gap-1 ${
                  conversionSettings.mode === 'smart'
                    ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:white'
                }`}
                title="স্মার্ট অটো: প্রয়োজনীয় টেক্সট ও ছবি/লোগো বুদ্ধিমত্তার সাথে আলাদা করবে"
              >
                <span>⚡ স্মার্ট</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeMode('image')}
                disabled={processingState.isConverting}
                className={`px-2 py-1 rounded transition-all flex items-center gap-1 ${
                  conversionSettings.mode === 'image'
                    ? 'bg-purple-600 text-white font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:white'
                }`}
                title="চিত্র সহ: বইয়ের সব ধরণের ছবি ও চিত্র ক্রপ করবে"
              >
                <span>🖼️ চিত্র</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeMode('text')}
                disabled={processingState.isConverting}
                className={`px-2 py-1 rounded transition-all flex items-center gap-1 ${
                  conversionSettings.mode === 'text'
                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:white'
                }`}
                title="শুধু টেক্সট: কোনো চিত্র ছাড়াই দ্রুত প্রসেসিং"
              >
                <span>📝 টেক্সট</span>
              </button>
            </div>
          )}

          {/* Rescan / Process Current Page button */}
          <button
            type="button"
            onClick={() => onRescanPage(currentPageIndex)}
            disabled={processingState.isConverting}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
              currentPage.status === 'error'
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs animate-bounce'
                : currentPage.status === 'completed'
                ? 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                : 'border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60'
            }`}
            title="এই পৃষ্ঠাটি পুনরায় ভিশন এআই দিয়ে স্ক্যান করুন"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>
              {currentPage.status === 'error'
                ? 'ত্রুটি: রিস্ক্যান'
                : currentPage.status === 'completed'
                ? 'রিস্ক্যান'
                : 'ওসিআর'}
            </span>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 sm:gap-1 border-l border-slate-200 dark:border-slate-800 pl-1.5 sm:pl-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(45, z - 15))}
              className="p-1 sm:p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="জুম আউট"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="text-[10px] sm:text-[11px] font-mono text-slate-600 dark:text-slate-300 w-8 sm:w-10 text-center font-semibold hover:text-indigo-600"
              title="১০০% জুমে রিসেট করুন"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(230, z + 15))}
              className="p-1 sm:p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="জুম ইন"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Preview Workspace (Strictly isolated scrolling with overscroll-contain) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onWheel={(e) => e.stopPropagation()}
        tabIndex={0}
        className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-auto overscroll-contain p-2 sm:p-4 md:p-6 relative focus:outline-none select-none"
        style={{ overscrollBehavior: 'contain' }}
      >
        {isContinuousView && pages && pages.length > 0 ? (
          /* ================= CONTINUOUS ALL-PAGES VERTICAL STREAM ================= */
          <div className="flex flex-col items-center gap-6 sm:gap-8 pb-16">
            {pages.map((page, idx) => {
              const isSelected = idx === currentPageIndex;
              const isProcessing =
                processingState.isConverting && processingState.currentPageNumber === page.pageNumber;

              return (
                <div
                  key={page.pageNumber}
                  id={`pdf-page-${page.pageNumber}`}
                  onClick={() => onSelectPage && onSelectPage(idx)}
                  className={`group relative bg-white dark:bg-slate-900 shadow-md hover:shadow-xl rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'ring-3 ring-indigo-500/80 border-indigo-400 dark:border-indigo-600 shadow-indigo-100 dark:shadow-indigo-950/30'
                      : 'border-slate-300/80 dark:border-slate-800 opacity-90 hover:opacity-100'
                  }`}
                  style={{ width: `${zoom}%`, maxWidth: '920px', minWidth: 0 }}
                >
                  {/* Top Bar for each page card */}
                  <div className="px-3.5 py-1.5 bg-slate-100/90 dark:bg-slate-800/90 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        পৃষ্ঠা {page.pageNumber}
                      </span>
                      {page.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle className="w-3 h-3" />
                          <span>সম্পন্ন</span>
                        </span>
                      )}
                      {page.status === 'processing' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold animate-pulse">
                          <Clock className="w-3 h-3 animate-spin" />
                          <span>স্ক্যান হচ্ছে...</span>
                        </span>
                      )}
                      {page.status === 'excluded' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          <SkipForward className="w-3 h-3" />
                          <span>স্কিপ</span>
                        </span>
                      )}
                      {page.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          <span>ত্রুটি</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {isSelected && (
                        <span className="text-[10px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full">
                          বর্তমান পৃষ্ঠা
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Page Image */}
                  <div className="relative">
                    {page.fullImageUrl || page.thumbnailUrl ? (
                      <img
                        src={page.fullImageUrl || page.thumbnailUrl || ''}
                        alt={`Page ${page.pageNumber}`}
                        className="w-full h-auto object-contain block select-none pointer-events-none"
                        loading="lazy"
                      />
                    ) : (
                      <div className="aspect-[3/4] flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-400 text-sm">
                        পৃষ্ঠা রেন্ডার হচ্ছে...
                      </div>
                    )}

                    {/* Laser Scanner if processing */}
                    {isProcessing && (
                      <>
                        <div className="animate-scan z-20 pointer-events-none" />
                        <div className="absolute inset-0 bg-indigo-900/10 pointer-events-none z-10" />
                      </>
                    )}

                    {/* Detected figures bounding boxes */}
                    {renderFigures(page)}

                    {/* Skipped / Error banners */}
                    {renderBanners(page, idx)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ================= SINGLE PAGE VIEW (CLEAN TOP-TO-BOTTOM SCROLL) ================= */
          <div className="flex flex-col items-center justify-start pb-16">
            <div
              id={`pdf-page-${currentPage.pageNumber}`}
              className="relative bg-white dark:bg-slate-900 shadow-xl rounded-xl overflow-hidden border border-slate-300/80 dark:border-slate-800 transition-all duration-150 mx-auto"
              style={{ width: `${zoom}%`, maxWidth: '920px', minWidth: 0 }}
            >
              {currentPage.fullImageUrl ? (
                <img
                  src={currentPage.fullImageUrl}
                  alt={`Page ${currentPage.pageNumber}`}
                  className="w-full h-auto object-contain block select-none"
                />
              ) : (
                <div className="aspect-[3/4] flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-400 text-sm">
                  পৃষ্ঠা রেন্ডার হচ্ছে...
                </div>
              )}

              {/* Laser Scanner Animation */}
              {isCurrentPageProcessing && (
                <>
                  <div className="animate-scan z-20 pointer-events-none" />
                  <div className="absolute inset-0 bg-indigo-900/10 pointer-events-none z-10" />
                </>
              )}

              {/* Figures bounding boxes */}
              {renderFigures(currentPage)}

              {/* Skipped / Error banners */}
              {renderBanners(currentPage, currentPageIndex)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
