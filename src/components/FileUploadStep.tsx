import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, Sparkles, BookOpen, CheckCircle, ShieldCheck, ArrowRight, Zap } from 'lucide-react';

interface FileUploadStepProps {
  onFileSelected: (file: File) => void;
  onLoadSampleBook: () => void;
  isLoading: boolean;
  loadingMessage?: string;
}

export const FileUploadStep: React.FC<FileUploadStepProps> = ({
  onFileSelected,
  onLoadSampleBook,
  isLoading,
  loadingMessage,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      onFileSelected(file);
    } else if (file) {
      alert('অনুগ্রহ করে একটি বৈধ পিডিএফ (.pdf) ফাইল নির্বাচন করুন।');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-5 sm:py-12">
      {/* Hero Headline */}
      <div className="text-center space-y-2.5 sm:space-y-3 mb-6 sm:mb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/80 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>গুগল জেমিনাই ভিশন এআই চালিত বাংলা কনভার্টার</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          যেকোনো বাংলা পিডিএফ রূপান্তর করুন <span className="text-indigo-600 dark:text-indigo-400">নিখুঁত ইপাবে (EPUB)</span>
        </h2>
        <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-base max-w-2xl mx-auto leading-relaxed">
          স্ক্যান করা প্রাচীন বা আধুনিক বাংলা বইয়ের যুক্তাক্ষর, কবিতা ও চিত্রাবলী চিহ্নিত করে তৈরি করুন স্মার্ট, রেস্পন্সিভ ও স্ট্যান্ডার্ড বাংলা ই-বুক।
        </p>
      </div>

      {/* Main Upload Box */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-xl dark:shadow-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-10 relative overflow-hidden transition-colors">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-indigo-100 dark:border-slate-800 border-t-indigo-600 dark:border-t-indigo-400 animate-spin" />
              <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-slate-800 dark:text-white">
                {loadingMessage || 'পিডিএফ ফাইল লোড ও বিশ্লেষণ হচ্ছে...'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                পৃষ্ঠাগুলোর প্রাথমিক থাম্বনেইল প্রস্তুত করা হচ্ছে
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 sm:p-12 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                isDragOver
                  ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40 scale-[1.01]'
                  : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50/60 dark:hover:bg-slate-800/60 bg-slate-50/30 dark:bg-slate-900/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileInput}
                className="hidden"
              />

              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-indigo-100/80 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 sm:mb-4 shadow-xs">
                <UploadCloud className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>

              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white mb-1">
                বাংলা পিডিএফ ফাইল এখানে ড্র্যাগ করে এনে ছাড়ুন
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 max-w-sm mb-4">
                অথবা আপনার ডিভাইস থেকে যেকোনো সাইজের বাংলা বই বা ডকুমেন্টের পিডিএফ ফাইল বেছে নিন
              </p>

              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-950 transition-all cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>পিডিএফ ফাইল নির্বাচন করুন</span>
              </button>

              <div className="text-[11px] text-slate-400 dark:text-slate-400 mt-3">
                সর্বোচ্চ সাইজ লিমিট আনলকড • নিরাপদ ও সম্পূর্ণ গোপনীয়
              </div>
            </div>

            {/* Quick Sample Book Option */}
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              <span className="flex-shrink mx-4 text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                অথবা সরাসরি ট্রাই করুন
              </span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            </div>

            <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-amber-950/40 border border-amber-200/80 dark:border-amber-800/70 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 transition-colors">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-200 dark:shadow-amber-950 flex-shrink-0">
                  <BookOpen className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-xs sm:text-sm text-amber-950 dark:text-amber-100 flex items-center gap-1.5 flex-wrap">
                    <span className="truncate">নমুনা বই: রক্তকরবী (রবীন্দ্রনাথ ঠাকুর)</span>
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-full font-bold flex-shrink-0">
                      ৫ পৃষ্ঠা ডেমো
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-amber-800/90 dark:text-amber-300 mt-0.5">
                    প্রচ্ছদ, সূচীপত্র, কবিতা, চিত্র ও যুক্তাক্ষর সহ প্রস্তুত করা ডেমো বই
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onLoadSampleBook}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors flex-shrink-0 cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>নমুনা বই দিয়ে টেস্ট করুন</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <h4 className="font-bold text-sm text-slate-800 dark:text-white">উন্নত ভিশন ওসিআর</h4>
          <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
            গুগল জেমিনাই ভিশন এআই দিয়ে যেকোনো জটিল বাংলা ফন্ট, স্ক্যান নয়েজ ও যুক্তাক্ষর নির্ভুলভাবে ধারণ করে।
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h4 className="font-bold text-sm text-slate-800 dark:text-white">ওয়াটারমার্ক ও স্ক্যানার ছাঁটাই</h4>
          <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
            স্ক্যানারের নাম, ওয়েবসাইট ও অবাঞ্ছিত দাগ স্বয়ংক্রিয়ভাবে ফিল্টার করে পরিষ্কার টেক্সট তৈরি করে।
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCircle className="w-4 h-4" />
          </div>
          <h4 className="font-bold text-sm text-slate-800 dark:text-white">বৈধ EPUB 3 ফরম্যাট</h4>
          <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
            স্মার্টফোন, কিন্ডল ও যেকোনো ই-রিডার ডিভাইসে চমৎকার বাংলা ফন্ট ও সূচীপত্রসহ পড়ার পূর্ণ নিশ্চয়তা।
          </p>
        </div>
      </div>
    </div>
  );
};
