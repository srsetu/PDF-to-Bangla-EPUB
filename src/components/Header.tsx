import React, { useRef, useState } from 'react';
import {
  BookOpen,
  Sparkles,
  Download,
  Trash2,
  FileUp,
  Zap,
  Sun,
  Moon,
  Columns3,
  SlidersHorizontal,
  BookMarked,
  MoreVertical,
  Check,
  Clock,
} from 'lucide-react';
import { formatElapsedTime } from '../utils/timeHelper';

interface HeaderProps {
  currentStep: number;
  onReset: () => void;
  onRemovePdf: () => void;
  onReplacePdf: (file: File) => void;
  onOpenConfig: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  hasDocument: boolean;
  canExport: boolean;
  bookTitle?: string;
  onResetLayout?: () => void;
  onOpenKeyPool?: () => void;
  keyCount?: number;
  rpmCapacity?: number;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  totalPages?: number;
  completedCount?: number;
  isConverting?: boolean;
  elapsedSeconds?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep,
  onReset,
  onRemovePdf,
  onReplacePdf,
  onOpenConfig,
  onOpenSettings,
  onOpenExport,
  hasDocument,
  canExport,
  bookTitle,
  onResetLayout,
  onOpenKeyPool,
  keyCount = 1,
  rpmCapacity = 15,
  theme = 'light',
  onToggleTheme,
  totalPages = 0,
  completedCount = 0,
  isConverting = false,
  elapsedSeconds = 0,
}) => {
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showLayoutResetToast, setShowLayoutResetToast] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onReplacePdf(file);
      e.target.value = '';
    }
  };

  const handleTriggerResetLayout = () => {
    if (onResetLayout) {
      onResetLayout();
      setShowLayoutResetToast(true);
      setTimeout(() => setShowLayoutResetToast(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Brand Identity & Active Document Title */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-violet-600 flex items-center justify-center text-white shadow-sm ring-1 ring-white/20 flex-shrink-0">
            <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-bold text-slate-900 dark:text-white text-[15px] sm:text-lg tracking-tight leading-tight truncate">
                বাংলা ইপাব <span className="text-indigo-600 dark:text-indigo-400 font-semibold">স্টুডিও</span>
              </h1>
              <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex-shrink-0">
                <Sparkles className="w-2.5 h-2.5 text-emerald-500" /> ভিশন এআই
              </span>
            </div>

            {hasDocument && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0 mt-0.5">
                <span className="font-medium truncate max-w-[140px] sm:max-w-[220px] text-slate-700 dark:text-slate-300">
                  {bookTitle || 'নামহীন বই'}
                </span>
                {totalPages > 0 && (
                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 flex-shrink-0 whitespace-nowrap">
                    • {totalPages}টি পাতা
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Conversion / Smart Mode Status Badge & Elapsed Timer */}
        {hasDocument && (
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            {isConverting ? (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-2xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
                </span>
                <span>রূপান্তর চলছে: {completedCount} / {totalPages} সম্পন্ন</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                <Sparkles className="w-3 h-3 text-indigo-500" />
                <span>স্মার্ট অটো-মোড (টেক্সট + চিত্র অটো-সুইচ)</span>
              </div>
            )}

            {/* Total Elapsed Scanning Timer */}
            {(isConverting || elapsedSeconds > 0) && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold border transition-all ${
                  isConverting
                    ? 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
                title="মোট স্ক্যানিং ব্যয়িত সময়"
              >
                <Clock className={`w-3.5 h-3.5 ${isConverting ? 'text-rose-600 animate-spin' : 'text-slate-500'}`} />
                <span>সময়: {formatElapsedTime(elapsedSeconds)}</span>
              </div>
            )}
          </div>
        )}

        {/* Right: Modern Minimal Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Hidden file input for replacing PDF */}
          <input
            ref={replaceFileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Multi-Key Pool Indicator Badge */}
          {onOpenKeyPool && (
            <button
              type="button"
              onClick={onOpenKeyPool}
              className={`${
                hasDocument ? 'hidden sm:inline-flex' : 'inline-flex'
              } items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 h-9 sm:min-h-[40px] rounded-lg text-xs font-semibold bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/70 transition-all shadow-2xs`}
              title="একাধিক জেমিনাই এআই কী যোগ করে লিমিট ও স্পিড বৃদ্ধি করুন"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
              <span className="hidden sm:inline">কী পুল</span>
              <span className="font-mono bg-amber-200/90 dark:bg-amber-900/90 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 rounded text-[10.5px]">
                {keyCount} <span className="hidden xs:inline">কী</span>
              </span>
            </button>
          )}

          {hasDocument && (
            <>
              {/* Discrete Layout Reset Control (Desktop only, where resizable panels exist) */}
              {onResetLayout && (
                <div className="relative hidden lg:block">
                  <button
                    type="button"
                    onClick={handleTriggerResetLayout}
                    className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
                    title="প্যানেল অনুপাত ডিফল্ট সাইজে রিসেট করুন"
                  >
                    <Columns3 className="w-4 h-4" />
                  </button>
                  {showLayoutResetToast && (
                    <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-slate-900 dark:bg-slate-800 text-white text-[10.5px] whitespace-nowrap shadow-lg flex items-center gap-1 z-50">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>লেআউট রিসেট হয়েছে</span>
                    </div>
                  )}
                </div>
              )}

              {/* AI Model & Mode Settings */}
              <button
                type="button"
                onClick={onOpenSettings}
                className="hidden sm:flex p-2 min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
                title="এআই মডেল, মোড ও স্পিড সেটিংস"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>

              {/* Book Prompt Segments Config */}
              <button
                type="button"
                onClick={onOpenConfig}
                className="hidden sm:inline-flex p-2 min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
                title="বইয়ের ৩টি সেগমেন্ট ও প্রম্পট কনফিগারেশন"
              >
                <BookMarked className="w-4 h-4" />
              </button>

              {/* More Actions Dropdown Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu((prev) => !prev)}
                  className="p-2 h-9 w-9 sm:min-h-[40px] sm:min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
                  title="অতিরিক্ত অপশন"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showMenu && (
                  <>
                    {/* Backdrop to close menu on tap anywhere */}
                    <div
                      className="fixed inset-0 z-40 bg-transparent"
                      onClick={() => setShowMenu(false)}
                    />
                    <div
                      className="absolute right-0 top-full mt-1.5 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          replaceFileInputRef.current?.click();
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                      >
                        <FileUp className="w-3.5 h-3.5 text-indigo-500" />
                        <span>নতুন ফাইল আপলোড</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          onOpenConfig();
                        }}
                        className="sm:hidden w-full text-left px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                      >
                        <BookMarked className="w-3.5 h-3.5 text-indigo-500" />
                        <span>বই কনফিগারেশন</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          onOpenSettings();
                        }}
                        className="sm:hidden w-full text-left px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                        <span>এআই মডেল সেটিংস</span>
                      </button>

                      {onOpenKeyPool && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMenu(false);
                            onOpenKeyPool();
                          }}
                          className="sm:hidden w-full text-left px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>কী পুল সেটিংস</span>
                          </span>
                          <span className="font-mono bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                            {keyCount} কী
                          </span>
                        </button>
                      )}

                      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          onRemovePdf();
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        <span>পিডিএফ মুছুন</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Theme Toggle (Light / Dark Mode) */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-2 h-9 w-9 sm:min-h-[40px] sm:min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
              title={theme === 'dark' ? 'লাইট মোডে পরিবর্তন করুন' : 'ডার্ক মোডে পরিবর্তন করুন'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 transition-transform duration-300 rotate-0 hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700 transition-transform duration-300" />
              )}
            </button>
          )}

          {/* Primary CTA: EPUB Export & Preview */}
          {hasDocument && (
            <button
              type="button"
              onClick={onOpenExport}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 h-9 sm:min-h-[40px] rounded-lg text-xs sm:text-sm font-semibold transition-all shadow-xs cursor-pointer whitespace-nowrap ${
                canExport
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-500/20 active:scale-98'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700/60'
              }`}
            >
              <Download className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">ইপাব তৈরি</span>
              <span className="sm:hidden">ইপাব</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
