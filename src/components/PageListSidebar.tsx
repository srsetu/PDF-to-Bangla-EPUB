import React, { useState, useRef, useEffect } from 'react';
import { PageItem } from '../types';
import { isTableOfContentsText, isLikelyTocPage } from '../utils/epubGenerator';
import { Search, CheckCircle, Clock, SkipForward, AlertCircle, Sparkles, Image as ImageIcon, Eye, Trash2, FileUp, FileText, RotateCcw, ListOrdered, Radio } from 'lucide-react';

interface PageListSidebarProps {
  pages: PageItem[];
  selectedPageIndex: number;
  onSelectPage: (index: number) => void;
  onToggleExclude: (index: number) => void;
  onToggleTocPage?: (index: number) => void;
  onDeletePage: (index: number) => void;
  isConverting: boolean;
  onRemovePdf: () => void;
  onReplacePdf: (file: File) => void;
  onRescanPage: (index: number) => void;
  bookTitle?: string;
  width?: number;
  isLiveTracking?: boolean;
}

export const PageListSidebar: React.FC<PageListSidebarProps> = ({
  pages,
  selectedPageIndex,
  onSelectPage,
  onToggleExclude,
  onToggleTocPage,
  onDeletePage,
  isConverting,
  onRemovePdf,
  onReplacePdf,
  onRescanPage,
  bookTitle,
  width,
  isLiveTracking = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'completed' | 'pending' | 'excluded' | 'error'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll selected thumbnail into view when selectedPageIndex changes (e.g. during Live Auto-Follow)
  useEffect(() => {
    if (selectedPageIndex >= 0 && pages[selectedPageIndex]) {
      const targetPageNum = pages[selectedPageIndex].pageNumber;
      const el = document.getElementById(`sidebar-page-${targetPageNum}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedPageIndex, pages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onReplacePdf(file);
      e.target.value = '';
    }
  };

  const filteredPages = pages.filter((page) => {
    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchPage = `পৃষ্ঠা ${page.pageNumber}`.includes(q) || page.pageNumber.toString().includes(q);
      const matchText = page.markdown.toLowerCase().includes(q);
      if (!matchPage && !matchText) return false;
    }

    // Filter by tab
    if (filter === 'completed') return page.status === 'completed';
    if (filter === 'pending') return page.status === 'pending' || page.status === 'processing';
    if (filter === 'excluded') return page.status === 'excluded';
    if (filter === 'error') return page.status === 'error';
    return true;
  });

  const completedCount = pages.filter((p) => p.status === 'completed').length;
  const excludedCount = pages.filter((p) => p.status === 'excluded').length;
  const errorCount = pages.filter((p) => p.status === 'error').length;

  return (
    <div
      style={{
        maxWidth: '100%',
        ...(width ? ({ '--sidebar-width': `${width}px` } as React.CSSProperties) : {}),
      }}
      className="w-full lg:w-[var(--sidebar-width,280px)] flex-shrink-0 flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-colors overflow-hidden"
    >
      {/* Hidden file input for replacing PDF */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* File Info & Quick Management Bar */}
      <div className="px-3.5 py-2.5 bg-slate-100/80 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate" title={bookTitle || 'পিডিএফ ফাইল'}>
              {bookTitle || 'বর্তমান পিডিএফ ফাইল'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 flex-shrink-0">
            {pages.length} পাতা
          </span>
        </div>

        {/* Change / Delete Buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1 py-1 px-2 rounded-lg text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/80 transition-colors shadow-2xs"
            title="অন্য একটি পিডিএফ ফাইল নির্বাচন করুন"
          >
            <FileUp className="w-3 h-3" />
            <span>নতুন পিডিএফ</span>
          </button>

          <button
            type="button"
            onClick={onRemovePdf}
            className="inline-flex items-center justify-center gap-1 py-1 px-2 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 transition-colors shadow-2xs"
            title="বর্তমান পিডিএফ মুছে ফেলে আপলোড স্ক্রিনে ফিরুন"
          >
            <Trash2 className="w-3 h-3" />
            <span>মুছে ফেলুন</span>
          </button>
        </div>
      </div>

      {/* Top Bar */}
      <div className="p-3.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">সমস্ত পৃষ্ঠা</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-bold">
              {pages.length} টি
            </span>
            {isConverting && isLiveTracking && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-600 text-white shadow-2xs animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                লাইভ ট্র্যাকিং
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            সম্পন্ন: <strong className="text-emerald-600 dark:text-emerald-400">{completedCount}</strong> | স্কিপ: {excludedCount}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="পৃষ্ঠা নম্বর বা শব্দ খুঁজুন..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 text-[11px] font-medium flex-wrap">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded-md transition-colors ${
              filter === 'all'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            সব ({pages.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('completed')}
            className={`px-2 py-1 rounded-md transition-colors ${
              filter === 'completed'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            সম্পন্ন ({completedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('pending')}
            className={`px-2 py-1 rounded-md transition-colors ${
              filter === 'pending'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            অপেক্ষমান
          </button>
          <button
            type="button"
            onClick={() => setFilter('excluded')}
            className={`px-2 py-1 rounded-md transition-colors ${
              filter === 'excluded'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            স্কিপ করা ({excludedCount})
          </button>
          {errorCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('error')}
              className={`px-2 py-1 rounded-md transition-colors animate-pulse ${
                filter === 'error'
                  ? 'bg-rose-700 text-white font-bold'
                  : 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-800 font-semibold'
              }`}
            >
              ত্রুটি ({errorCount})
            </button>
          )}
        </div>
      </div>

      {/* Page Thumbnails List */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2.5">
        {filteredPages.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            কোনো পৃষ্ঠা পাওয়া যায়নি
          </div>
        ) : (
          filteredPages.map((page) => {
            const originalIndex = pages.findIndex((p) => p.pageNumber === page.pageNumber);
            const isSelected = originalIndex === selectedPageIndex;

            return (
              <div
                key={page.pageNumber}
                id={`sidebar-page-${page.pageNumber}`}
                onClick={() => onSelectPage(originalIndex)}
                className={`group relative rounded-xl border p-2.5 transition-all cursor-pointer flex gap-3 ${
                  isSelected
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/60 ring-2 ring-indigo-500/40 shadow-xs'
                    : page.status === 'processing'
                    ? 'border-rose-500 dark:border-rose-500 bg-rose-50/60 dark:bg-rose-950/40 ring-2 ring-rose-400/50 shadow-xs'
                    : page.status === 'excluded'
                    ? 'border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/40 opacity-60'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50/60 dark:hover:bg-slate-800'
                }`}
              >
                {/* Thumbnail Preview Image */}
                <div className="relative w-14 h-20 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {page.thumbnailUrl || page.fullImageUrl ? (
                    <img
                      src={page.thumbnailUrl || page.fullImageUrl || ''}
                      alt={`Page ${page.pageNumber}`}
                      className="w-full h-full object-cover object-top"
                      loading="lazy"
                    />
                  ) : (
                    <div className="text-[10px] text-slate-400 font-mono">
                      পাতা {page.pageNumber}
                    </div>
                  )}

                  {/* Processing pulse on thumbnail */}
                  {page.status === 'processing' && (
                    <div className="absolute inset-0 bg-indigo-600/30 backdrop-blur-2xs flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </div>

                {/* Page Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5 flex-wrap">
                        <span>পৃষ্ঠা {page.pageNumber}</span>
                        {isLikelyTocPage(page, pages) && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded shadow-2xs"
                            title="এই পৃষ্ঠাটি বইয়ের সূচিপত্র হিসেবে চিহ্নিত (চ্যাপ্টারে লিঙ্কিং সক্রিয়)"
                          >
                            <ListOrdered className="w-2.5 h-2.5 text-amber-700 dark:text-amber-300" />
                            <span>সূচিপত্র</span>
                          </span>
                        )}
                        {(page.figures && page.figures.length > 0) || (page.status !== 'completed' && Boolean(page.hasImages)) ? (
                          <span
                            className="inline-flex items-center gap-1 text-[9.5px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800"
                            title="এই পৃষ্ঠায় চিত্র রয়েছে"
                          >
                            <ImageIcon className="w-2.5 h-2.5" />
                            <span>চিত্র</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[9.5px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700"
                            title="এই পৃষ্ঠায় চিত্র নেই (শুধুই টেক্সট)"
                          >
                            <FileText className="w-2.5 h-2.5 text-slate-500" />
                            <span>টেক্সট</span>
                          </span>
                        )}
                        {page.status === 'excluded' && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800/80 px-1.5 py-0.5 rounded">
                            <SkipForward className="w-2.5 h-2.5" />
                            <span>স্কিপ করা</span>
                          </span>
                        )}
                      </div>

                      {/* Status indicator badge */}
                      {page.status === 'completed' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle className="w-3 h-3" />
                          <span>সম্পন্ন</span>
                        </span>
                      )}
                      {page.status === 'processing' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 animate-pulse">
                          <Sparkles className="w-3 h-3" />
                          <span>ওসিআর</span>
                        </span>
                      )}
                      {page.status === 'pending' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          <Clock className="w-3 h-3" />
                          <span>অপেক্ষমান</span>
                        </span>
                      )}
                      {page.status === 'error' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-800">
                          <AlertCircle className="w-3 h-3" />
                          <span>ত্রুটি</span>
                        </span>
                      )}
                    </div>

                    {/* Excerpt / Markdown Snippet */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-snug">
                      {page.markdown
                        ? page.markdown.replace(/^[#>\-\*\s]+/gm, '').slice(0, 75) + '...'
                        : 'এখনো টেক্সট এক্সট্রাক্ট করা হয়নি।'}
                    </p>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                    <div className="flex items-center gap-2">
                      {/* Option 1: Skip / Unskip */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleExclude(originalIndex);
                        }}
                        className={`hover:underline flex items-center gap-0.5 font-medium ${
                          page.status === 'excluded'
                            ? 'text-indigo-600 dark:text-indigo-400 font-bold'
                            : 'text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400'
                        }`}
                        title={page.status === 'excluded' ? 'পৃষ্ঠাটি অন্তর্ভুক্ত করুন (আন-স্কিপ)' : 'রূপান্তর থেকে এই পৃষ্ঠা স্কিপ করুন'}
                      >
                        {page.status === 'excluded' ? (
                          <>
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>আন-স্কিপ</span>
                          </>
                        ) : (
                          <>
                            <SkipForward className="w-2.5 h-2.5" />
                            <span>স্কিপ</span>
                          </>
                        )}
                      </button>

                      {/* Option 2: Delete Page */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePage(originalIndex);
                        }}
                        className="text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-0.5 hover:underline font-medium transition-colors"
                        title="এই পৃষ্ঠাটি সম্পূর্ণরূপে তালিকা থেকে মুছে ফেলুন"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-rose-500" />
                        <span>ডিলিট</span>
                      </button>

                      {page.status === 'error' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRescanPage(originalIndex);
                          }}
                          className="text-rose-600 hover:text-rose-800 font-bold bg-rose-50 hover:bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200 animate-pulse"
                          title="ত্রুটি দূর করতে পৃষ্ঠাটি পুনরায় স্ক্যান করুন"
                        >
                          রিস্ক্যান
                        </button>
                      )}
                    </div>

                    {page.figures?.length > 0 && (
                      <span className="flex items-center gap-0.5 text-purple-600 font-medium" title="চিত্র শনাক্ত হয়েছে">
                        <ImageIcon className="w-3 h-3" />
                        <span>{page.figures.length}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
