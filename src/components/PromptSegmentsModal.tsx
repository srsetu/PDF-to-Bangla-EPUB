import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Book,
  Layers,
  ShieldAlert,
  Plus,
  X,
  Check,
  ArrowRight,
  ArrowLeft,
  Cpu,
  FileText,
  Image as ImageIcon,
  Globe
} from 'lucide-react';
import {
  BookDetails,
  StructureConfig,
  WatermarkConfig,
  ConversionSettings,
  ModelOption
} from '../types';

interface PromptSegmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    bookDetails: BookDetails,
    structureConfig: StructureConfig,
    watermarkConfig: WatermarkConfig,
    conversionSettings: ConversionSettings
  ) => void;
  initialBookDetails: BookDetails;
  initialStructureConfig: StructureConfig;
  initialWatermarkConfig: WatermarkConfig;
  initialConversionSettings: ConversionSettings;
  totalPages?: number;
}

export const PromptSegmentsModal: React.FC<PromptSegmentsModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialBookDetails,
  initialStructureConfig,
  initialWatermarkConfig,
  initialConversionSettings,
  totalPages = 0,
}) => {
  // 4 steps: 1 = AI Model & Mode (Upfront!), 2 = Book Identity, 3 = Structure, 4 = Watermarks
  const [activeSegment, setActiveSegment] = useState<1 | 2 | 3 | 4>(1);

  // AI Model & Mode State (Upfront)
  const [conversionSettings, setConversionSettings] = useState<ConversionSettings>(initialConversionSettings);

  // Book Details State
  const [bookDetails, setBookDetails] = useState<BookDetails>(initialBookDetails);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Structure & Exclusions State
  const [structureConfig, setStructureConfig] = useState<StructureConfig>(initialStructureConfig);

  // Watermarks State
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(initialWatermarkConfig);
  const [newFilterInput, setNewFilterInput] = useState('');

  // Sync state whenever modal is opened with fresh props
  useEffect(() => {
    if (isOpen) {
      setBookDetails(initialBookDetails);
      setConversionSettings(initialConversionSettings);
      setStructureConfig(initialStructureConfig);
      setWatermarkConfig(initialWatermarkConfig);
      setTitleError(null);
    }
  }, [isOpen, initialBookDetails, initialConversionSettings, initialStructureConfig, initialWatermarkConfig]);

  if (!isOpen) return null;

  const modelCards: Array<{
    id: ModelOption;
    code: string;
    name: string;
    tag: string;
    desc: string;
    recommended?: boolean;
  }> = [
    {
      id: 'LTGB',
      code: 'LTGB',
      name: 'স্ট্যান্ডার্ড ভিশন মডেল (LTGB)',
      tag: 'Gemini 3.1 Flash Lite (হাই স্পিড ও কোটা)',
      desc: 'সর্বাধিক দ্রুত ও স্থিতিশীল! বাংলা যুক্তাক্ষর, প্রাচীন বানান ও লেআউট নিখুঁতভাবে পাঠোদ্ধার করে।',
      recommended: true,
    },
    {
      id: 'LTLB',
      code: 'LTLB',
      name: 'হালকা ও দ্রুত মডেল (LTLB)',
      tag: 'Gemini 3.1 Flash Lite (লাইটওয়েট)',
      desc: 'সাধারণ ও দ্রুত ওসিআর, অল্প টোকেন ও হালকা বইয়ের পাতার জন্য উপযোগী।',
    },
    {
      id: 'HTAV',
      code: 'HTAV',
      name: 'অ্যাডভান্সড ভিশন মডেল (HTAV)',
      tag: 'Gemini 3.8 Flash (অটো-ফলব্যাক সহ)',
      desc: 'ঝাপসা স্ক্যান কপি, জটিল প্রাচীন হস্তলিপি ও গভীর বিশ্লেষণের জন্য বিশেষ উপযোগী।',
    },
    {
      id: 'VHBB',
      code: 'VHBB',
      name: 'ম্যাক্স ক্যাপাসিটি মডেল (VHBB)',
      tag: 'Gemini 3.8 Flash (হাই ব্যাচ)',
      desc: 'একত্রে দীর্ঘ কবিতা, বড় সূচিপত্র ও টীকা সহ বিশদ বিশ্লেষণ ক্ষমতা।',
    },
  ];

  const handleAddWatermark = () => {
    const trimmed = newFilterInput.trim();
    if (!trimmed) return;
    if (!watermarkConfig.filters.includes(trimmed)) {
      setWatermarkConfig({
        ...watermarkConfig,
        filters: [...watermarkConfig.filters, trimmed],
      });
    }
    setNewFilterInput('');
  };

  const handleRemoveWatermark = (itemToRemove: string) => {
    setWatermarkConfig({
      ...watermarkConfig,
      filters: watermarkConfig.filters.filter((f) => f !== itemToRemove),
    });
  };

  const addPresetWatermark = (preset: string) => {
    if (!watermarkConfig.filters.includes(preset)) {
      setWatermarkConfig({
        ...watermarkConfig,
        filters: [...watermarkConfig.filters, preset],
      });
    }
  };

  const handleNextStep = () => {
    if (activeSegment === 2 && !bookDetails.title.trim()) {
      setTitleError('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম দিন।');
      return;
    }
    setTitleError(null);
    setActiveSegment((activeSegment + 1) as any);
  };

  const handleTabChange = (seg: 1 | 2 | 3 | 4) => {
    if (activeSegment === 2 && !bookDetails.title.trim() && seg !== 2) {
      setTitleError('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম দিন।');
      return;
    }
    setTitleError(null);
    setActiveSegment(seg);
  };

  const handleFinalSave = () => {
    if (!bookDetails.title || !bookDetails.title.trim()) {
      setTitleError('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম দিন।');
      setActiveSegment(2);
      return;
    }
    setTitleError(null);

    // Parse excluded pages
    const parsedExcluded: number[] = [];
    if (structureConfig.excludedPagesStr) {
      const parts = structureConfig.excludedPagesStr.split(/[,;\s]+/);
      parts.forEach((p) => {
        if (p.includes('-')) {
          const [startStr, endStr] = p.split('-');
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              parsedExcluded.push(i);
            }
          }
        } else {
          const num = parseInt(p, 10);
          if (!isNaN(num)) parsedExcluded.push(num);
        }
      });
    }

    onSave(
      bookDetails,
      {
        ...structureConfig,
        excludedPagesList: Array.from(new Set(parsedExcluded)),
      },
      watermarkConfig,
      conversionSettings
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92dvh] text-slate-800 dark:text-slate-100 transition-colors">
        {/* Modal Header */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-950/80">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2 truncate">
              <span className="truncate">বই ও এআই ওসিআর কনফিগারেশন</span>
              <span className="hidden sm:inline-block text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded-full flex-shrink-0">
                শুরুতেই সম্পূর্ণ সেটআপ
              </span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
              এআই মডেল, ইমেজ/টেক্সট মোড, বইয়ের তথ্য ও ছাঁটাই ফিল্টার
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 4 Segment Tabs */}
        <div className="px-3 sm:px-6 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => handleTabChange(1)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              activeSegment === 1
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>১. এআই মডেল ও মোড</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange(2)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              activeSegment === 2
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Book className="w-4 h-4" />
            <span>২. বইয়ের পরিচয়</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange(3)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              activeSegment === 3
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>৩. গঠন ও ছাঁটাই</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange(4)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              activeSegment === 4
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>৪. ওয়াটারমার্ক বর্জন</span>
          </button>
        </div>

        {/* Segment Contents */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* SEGMENT 1: এআই মডেল ও মোড নির্বাচন (Upfront!) */}
          {activeSegment === 1 && (
            <div className="space-y-5">
              <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-xl p-3 text-xs text-indigo-950 dark:text-indigo-200 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>গতি ও নির্ভুলতা নির্বাচন:</strong> সর্বোচ্চ দ্রুত গতি ও কোটার জন্য <strong>LTGB (Gemini 3.1 Flash Lite)</strong> এবং টেক্সট মোড ব্যবহার করুন। এটি প্রতিটি বাংলা পৃষ্ঠা ১-২ সেকেন্ডে নির্ভুলভাবে রূপান্তর করে।
                </div>
              </div>

              {/* Models Grid */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  এআই ভিশন মডেল নির্বাচন করুন:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {modelCards.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setConversionSettings({ ...conversionSettings, model: m.id })}
                      className={`p-3 rounded-xl border text-left transition-all relative ${
                        conversionSettings.model === m.id
                          ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20 shadow-2xs'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                      }`}
                    >
                      {m.recommended && (
                        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
                          সেরা গতি
                        </span>
                      )}
                      <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white pr-12">
                        {m.name}
                      </div>
                      <div className="text-[11px] font-mono text-indigo-700 dark:text-indigo-400 mt-0.5">
                        {m.tag}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Extraction Mode: Smart Auto vs Image vs Text */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  রূপান্তর ও এক্সট্রাকশন মোড:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setConversionSettings({ ...conversionSettings, mode: 'smart' })}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      conversionSettings.mode === 'smart'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-2 rounded-lg ${conversionSettings.mode === 'smart' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">
                        স্মার্ট
                      </span>
                    </div>
                    <div>
                      <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white">স্মার্ট অটো (অটোমেটিক)</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        টেক্সট ও ছবি বুদ্ধিমত্তার সাথে আলাদা করে নিখুঁতভাবে যুক্ত করবে।
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConversionSettings({ ...conversionSettings, mode: 'image' })}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      conversionSettings.mode === 'image'
                        ? 'border-purple-600 bg-purple-50/70 dark:bg-purple-950/60 ring-2 ring-purple-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-2 rounded-lg ${conversionSettings.mode === 'image' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white">চিত্র সহ (ইমেজ মোড)</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        টেক্সটের সাথে বইয়ের ছবি ও ফিগারগুলো ক্রপ করে যুক্ত হবে।
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConversionSettings({ ...conversionSettings, mode: 'text' })}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      conversionSettings.mode === 'text'
                        ? 'border-slate-700 bg-slate-100 dark:bg-slate-800 ring-2 ring-slate-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-2 rounded-lg ${conversionSettings.mode === 'text' ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white">শুধু টেক্সট (দ্রুততম)</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        শুধু বিশুদ্ধ টেক্সট নেওয়া হবে। সুপার ফাস্ট ও ছোট ফাইল সাইজ।
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Batch Size & Language */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center justify-between">
                    <span>একত্রে ব্যাচ প্রসেস:</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded text-[11px] border border-indigo-200 dark:border-indigo-800">
                      {Math.max(1, Math.min(5, conversionSettings.batchSize || 5))} পাতা একবারে
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setConversionSettings({ ...conversionSettings, batchSize: b })}
                        className={`flex-1 min-w-[40px] py-2 rounded-xl border text-center text-xs font-bold transition-all ${
                          (conversionSettings.batchSize || 5) === b
                            ? 'border-indigo-600 bg-indigo-600 text-white shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {b} পাতা
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800/80 mt-2 leading-relaxed">
                    ⚡ <strong>সর্বোচ্চ স্পিড:</strong> কিপুলে ৫টি কী থাকায় একত্রে ১ থেকে ৫ পাতা নির্বাচন করে সর্বোচ্চ গতিতে কোনো রেট-লিমিট এরর ছাড়াই ওসিআর সম্পন্ন হবে।
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    ভাষা নির্বাচন:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConversionSettings({ ...conversionSettings, language: 'bn' })}
                      className={`py-1.5 px-2 rounded-lg border text-center text-xs font-semibold transition-all ${
                        conversionSettings.language === 'bn'
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      শুধু বাংলা
                    </button>
                    <button
                      type="button"
                      onClick={() => setConversionSettings({ ...conversionSettings, language: 'bn-en' })}
                      className={`py-1.5 px-2 rounded-lg border text-center text-xs font-semibold transition-all ${
                        conversionSettings.language === 'bn-en'
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      বাংলা + ইংরেজি
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SEGMENT 2: বইয়ের পরিচয় */}
          {activeSegment === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  বইয়ের মূল নাম (Book Title) <span className="text-rose-500 font-bold">* (আবশ্যক)</span>
                </label>
                <input
                  type="text"
                  value={bookDetails.title}
                  onChange={(e) => {
                    setBookDetails({ ...bookDetails, title: e.target.value });
                    if (e.target.value.trim()) setTitleError(null);
                  }}
                  placeholder="যেমন: রক্তকরবী, শেষের কবিতা, পদ্মা নদীর মাঝি..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none transition-colors ${
                    titleError
                      ? 'border-rose-500 focus:ring-2 focus:ring-rose-500 bg-rose-50/40 dark:bg-rose-950/20'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 focus:ring-2 focus:ring-indigo-500'
                  }`}
                />
                {titleError ? (
                  <p className="text-xs text-rose-500 font-semibold mt-1.5 flex items-center gap-1 animate-pulse">
                    <span>⚠</span> {titleError}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    আপলোডকৃত ফাইলের নাম থেকে স্বয়ংক্রিয়ভাবে নির্ধারণ করা হয়েছে, প্রয়োজনমতো রিনেম করতে পারেন।
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    লেখক (Author)
                  </label>
                  <input
                    type="text"
                    value={bookDetails.author}
                    onChange={(e) => setBookDetails({ ...bookDetails, author: e.target.value })}
                    placeholder="যেমন: রবীন্দ্রনাথ ঠাকুর, মানিক বন্দ্যোপাধ্যায়..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    প্রকাশক (Publisher)
                  </label>
                  <input
                    type="text"
                    value={bookDetails.publisher}
                    onChange={(e) => setBookDetails({ ...bookDetails, publisher: e.target.value })}
                    placeholder="যেমন: বিশ্বভারতী, বাতিঘর, ইত্যাদি..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    বইয়ের ধরণ (Genre / Category)
                  </label>
                  <select
                    value={bookDetails.genre}
                    onChange={(e) => setBookDetails({ ...bookDetails, genre: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  >
                    <option value="উপন্যাস">উপন্যাস (Novel)</option>
                    <option value="ছোটগল্প / গল্পসংকলন">ছোটগল্প / গল্পসংকলন</option>
                    <option value="কবিতা ও কাব্যগ্রন্থ">কবিতা ও কাব্যগ্রন্থ</option>
                    <option value="নাটক ও প্রহসন">নাটক ও প্রহসন</option>
                    <option value="প্রবন্ধ ও গবেষণা">প্রবন্ধ ও গবেষণা</option>
                    <option value="আত্মজীবনী ও স্মৃতিকথা">আত্মজীবনী ও স্মৃতিকথা</option>
                    <option value="ইতিহাস ও ঐতিহ্য">ইতিহাস ও ঐতিহ্য</option>
                    <option value="অনুবাদ সাহিত্য">অনুবাদ সাহিত্য</option>
                    <option value="শিশু ও কিশোর সাহিত্য">শিশু ও কিশোর সাহিত্য</option>
                    <option value="সাধারণ / অন্যান্য">সাধারণ / অন্যান্য</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    প্রকাশের সাল বা সংস্করণ
                  </label>
                  <input
                    type="text"
                    value={bookDetails.publishYear || ''}
                    onChange={(e) => setBookDetails({ ...bookDetails, publishYear: e.target.value })}
                    placeholder="যেমন: ১৯২৪, প্রথম সংস্করণ..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  বইয়ের সংক্ষিপ্ত পরিচিতি (ঐচ্ছিক)
                </label>
                <textarea
                  rows={2}
                  value={bookDetails.description || ''}
                  onChange={(e) => setBookDetails({ ...bookDetails, description: e.target.value })}
                  placeholder="বই সম্পর্কে ২-৩ লাইনের তথ্য..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>
          )}

          {/* SEGMENT 3: বইয়ের গঠন ও ছাঁটাই */}
          {activeSegment === 3 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                  বইয়ের প্রকারভেদ (Book Structure)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'single', label: 'একক বই', desc: 'একটি মূল ধারাবাহিক বই' },
                    { key: 'anthology', label: 'সংকলন', desc: 'একাধিক গল্প/প্রবন্ধের সংকলন' },
                    { key: 'volume', label: 'খণ্ড বই', desc: '১ম/২য়/ধারাবাহিক খণ্ড' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStructureConfig({ ...structureConfig, bookType: item.key as any })}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        structureConfig.bookType === item.key
                          ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50'
                      }`}
                    >
                      <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white">{item.label}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 rounded-xl p-3 text-xs text-emerald-950 dark:text-emerald-200 flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>ইনডেন্টেশন ও অ্যালাইনমেন্ট সংরক্ষণ:</strong> স্ক্যানের মূল টেক্সটের বেসিক ইনডেন্টেশন এবং সেন্টার অ্যালাইন লেখাগুলো (যেমন কবিতার পঙক্তি, শিরোনাম, অধ্যায়ের ভাগ, সেকশন ব্রেক) স্বয়ংক্রিয়ভাবে সেন্টার ও লেফট অ্যালাইন সঠিক রাখা হবে।
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={structureConfig.hasPrintedToc}
                    onChange={(e) =>
                      setStructureConfig({ ...structureConfig, hasPrintedToc: e.target.checked })
                    }
                    className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500"
                  />
                  <span className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-medium">
                    বইটিতে ছাপানো সূচীপত্র রয়েছে (ইপাবের ভেতরে ক্লিকেবল চ্যাপ্টার নেভিগেশন ও ডিজিটাল সূচি তৈরি হবে)
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={structureConfig.includeTocInEpub}
                    onChange={(e) =>
                      setStructureConfig({ ...structureConfig, includeTocInEpub: e.target.checked })
                    }
                    className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500"
                  />
                  <span className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-medium">
                    ছাপানো সূচীপত্রের পৃষ্ঠাটি ইপাবের ভেতরে সরাসরি ক্লিকেবল নেভিগেশন পাতা হিসেবে রাখবেন
                  </span>
                </label>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  ভূমিকা, ব্ল্যাঙ্ক বা শুরুর অংশের যে পৃষ্ঠাগুলো বাদ দিতে চান (Exclude Pages)
                </label>
                <input
                  type="text"
                  value={structureConfig.excludedPagesStr}
                  onChange={(e) =>
                    setStructureConfig({ ...structureConfig, excludedPagesStr: e.target.value })
                  }
                  placeholder="যেমন: 1, 2 বা 1-3 (কমা বা হাইফেন দিয়ে লিখুন)"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                />
                {totalPages > 0 && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    মোট পৃষ্ঠা: {totalPages} টি। বাদ দেওয়া পাতাগুলো ইপাবে যোগ হবে না।
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SEGMENT 4: ওয়াটারমার্ক ও অবাঞ্ছিত টেক্সট ছাঁটাই */}
          {activeSegment === 4 && (
            <div className="space-y-4">
              <div className="bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                স্ক্যান করা বাংলা বইয়ে থাকা ওয়েবসাইট বা স্ক্যানারের ওয়াটারমার্ক টেক্সট থেকে ছেঁটে ফেলার তালিকা:
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  নতুন ওয়াটারমার্ক বা ওয়েবসাইটের নাম যোগ করুন
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFilterInput}
                    onChange={(e) => setNewFilterInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddWatermark()}
                    placeholder="যেমন: www.amarboi.com বা Scanned by CamScanner..."
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleAddWatermark}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs sm:text-sm shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>যোগ করুন</span>
                  </button>
                </div>
              </div>

              {/* Active Filters */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  বর্তমান ফিল্টার তালিকা ({watermarkConfig.filters.length} টি সক্রিয়):
                </label>
                {watermarkConfig.filters.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                    কোনো ওয়াটারমার্ক ফিল্টার নেই
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {watermarkConfig.filters.map((filter) => (
                      <span
                        key={filter}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 shadow-2xs"
                      >
                        <span>{filter}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveWatermark(filter)}
                          className="hover:text-rose-900 dark:hover:text-rose-100 rounded-sm"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Presets */}
              <div>
                <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  ক্লিক করে দ্রুত প্রিসেট যোগ করুন:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'www.amarboi.com',
                    'Scan by CamScanner',
                    'BanglaBooksPDF',
                    'Scanned by TapScanner',
                    'www.boimate.com',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => addPresetWatermark(preset)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watermarkConfig.removeHeaderFooter}
                    onChange={(e) =>
                      setWatermarkConfig({
                        ...watermarkConfig,
                        removeHeaderFooter: e.target.checked,
                      })
                    }
                    className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500"
                  />
                  <span className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-medium">
                    মুদ্রিত পৃষ্ঠা নম্বর এবং রানিং হেডার ও ফুটার সম্পূর্ণ বর্জন করুন
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 flex items-center justify-between gap-2.5">
          <div>
            {activeSegment > 1 ? (
              <button
                type="button"
                onClick={() => setActiveSegment((activeSegment - 1) as any)}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>পূর্ববর্তী</span>
              </button>
            ) : (
              <span className="text-xs text-slate-400 dark:text-slate-500">ধাপ ১ / ৪</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeSegment < 4 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="inline-flex items-center justify-center gap-1.5 px-4 sm:px-5 py-2 sm:py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <span>পরবর্তী ধাপ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSave}
                className="inline-flex items-center justify-center gap-1.5 px-4 sm:px-5 py-2 sm:py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>সেটিংস প্রয়োগ ও রূপান্তর</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
