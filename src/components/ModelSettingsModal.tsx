import React, { useState } from 'react';
import { Cpu, Check, X, Sparkles, Image as ImageIcon, FileText, Layers, Globe } from 'lucide-react';
import { ConversionSettings, ModelOption, LanguageOption, ExtractionMode } from '../types';

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ConversionSettings;
  onSave: (newSettings: ConversionSettings) => void;
}

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [current, setCurrent] = useState<ConversionSettings>(settings);

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
      tag: 'Gemini 3.1 Flash Lite (হাই কোটা ও দ্রুততম)',
      desc: 'সর্বোচ্চ গতি ও নির্ভরযোগ্যতা! ফ্রি কোটায় কোনো এরর ছাড়া শত শত পাতা দ্রুত স্ক্যান করার জন্য আদর্শ।',
      recommended: true,
    },
    {
      id: 'LTLB',
      code: 'LTLB',
      name: 'আল্ট্রা ফাস্ট লাইট মডেল (LTLB)',
      tag: 'Gemini Flash Lite Latest',
      desc: 'দ্রুততম প্রতিক্রিয়া, সাধারণ ও পরিষ্কার পৃষ্ঠার টেক্সট ও ছবি নিখুঁতভাবে উত্তোলনে সেরা।',
    },
    {
      id: 'HTAV',
      code: 'HTAV',
      name: 'হাই-টোকেন প্রিসিশন মডেল (HTAV)',
      tag: 'Gemini 3.1 Flash Lite (রেসিলিয়েন্ট)',
      desc: 'পুরোনো বা ঝাপসা স্ক্যান কপি, জটিল যুক্তাক্ষর ও দীর্ঘ অনুচ্ছেদ নির্ভুল রাখতে সক্ষম।',
    },
    {
      id: 'VHBB',
      code: 'VHBB',
      name: 'ম্যাক্স ব্যালেন্সড মডেল (VHBB)',
      tag: 'Gemini 3.1 Flash Lite (মাল্টি-কী ব্যাকড)',
      desc: 'একত্রে দীর্ঘ পাতা, টীকা, কবিতা ও বিস্তৃত সূচীপত্র নিখুঁতভাবে ধারণ করার সর্বাধিক ক্ষমতা।',
    },
  ];

  const handleSave = () => {
    onSave(current);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92dvh] text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-950/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-xl flex-shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">
                এআই মডেল ও কনভারশন মোড সেটিংস
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                জেমিনাই ভিশন এআই মডেল, ভাষা এবং ইমেজ/টেক্সট মোড
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-3.5 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6 flex-1">
          {/* 1. Model Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              ১. এআই মডেল নির্বাচন (AI Vision Model)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modelCards.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCurrent({ ...current, model: m.id })}
                  className={`p-3.5 rounded-xl border text-left transition-all relative ${
                    current.model === m.id
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                  }`}
                >
                  {m.recommended && (
                    <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-2xs">
                      রেকমেন্ডেড
                    </span>
                  )}
                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white pr-14">
                    {m.name}
                  </div>
                  <div className="text-[11px] font-mono text-indigo-700 dark:text-indigo-400 mt-0.5">
                    {m.tag}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Language & Batch Size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-200 dark:border-slate-800 pt-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>২. বইয়ের ভাষা নির্বাচন</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCurrent({ ...current, language: 'bn' })}
                  className={`py-2 px-3 rounded-xl border text-center text-xs font-semibold transition-all ${
                    current.language === 'bn'
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  শুধু বাংলা (Pure Bangla)
                </button>
                <button
                  type="button"
                  onClick={() => setCurrent({ ...current, language: 'bn-en' })}
                  className={`py-2 px-3 rounded-xl border text-center text-xs font-semibold transition-all ${
                    current.language === 'bn-en'
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  বাংলা + ইংরেজি (দ্বৈত)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>৩. ব্যাচ সাইজ (একত্রে যত পাতা)</span>
                </span>
                <span className="text-indigo-600 dark:text-indigo-400 font-bold text-xs bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                  {current.batchSize} পাতা একবারে
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setCurrent({ ...current, batchSize: b })}
                    className={`flex-1 min-w-[42px] py-2 rounded-xl border text-center text-xs font-bold transition-all ${
                      current.batchSize === b
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-2xs scale-[1.03]'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {b} পাতা
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                প্রতি ধাপে একসাথে যতগুলো পৃষ্ঠা প্যারালালভাবে জেমিনাই ভিশন দিয়ে প্রসেস হবে (১ থেকে ৫ পাতা)।
              </p>
              <div className="text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 mt-2 leading-relaxed">
                💡 <strong>কোটা ও মাল্টি-কী গতি:</strong> আপনার কিপুলে একাধিক কী সক্রিয় থাকায় এখন নিশ্চিন্তে ১ থেকে ৫ পাতা ব্যাচ নির্বাচন করে কোনো রেট-লিমিট এরর ছাড়াই দ্রুত রূপান্তর করতে পারবেন।
              </div>
            </div>
          </div>

          {/* 4. Extraction Mode (Smart Auto vs Image vs Text Mode) */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              ৪. রূপান্তর ও এক্সট্রাকশন মোড (Extraction Mode)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Smart Auto Mode (Recommended) */}
              <button
                type="button"
                onClick={() => setCurrent({ ...current, mode: 'smart' })}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between relative ${
                  current.mode === 'smart'
                    ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${current.mode === 'smart' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full shadow-2xs">
                      ডিফল্ট ও স্মার্ট
                    </span>
                  </div>
                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">স্মার্ট অটো (Smart Auto)</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    স্বয়ংক্রিয়ভাবে টেক্সট ও ছবি/লোগো উভয়ই যাচাই করবে এবং নির্ভুলভাবে ক্রপ করে সাজাবে।
                  </p>
                </div>
                <span className="inline-block mt-3 text-[10px] font-semibold text-indigo-700 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                  সর্বাধিক বুদ্ধিমত্তাসম্পন্ন
                </span>
              </button>

              {/* Image Mode */}
              <button
                type="button"
                onClick={() => setCurrent({ ...current, mode: 'image' })}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  current.mode === 'image'
                    ? 'border-purple-600 bg-purple-50/80 dark:bg-purple-950/60 ring-2 ring-purple-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${current.mode === 'image' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                      <ImageIcon className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">চিত্র সহ (Image + Text)</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    পাতায় থাকা সব ছবি, ফিগার ও চিত্রগুলো নির্দিষ্ট সীমানায় ক্রপ করে পাতায় জুড়ে দিবে।
                  </p>
                </div>
                <span className="inline-block mt-3 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
                  চিত্র ও ইলাস্ট্রেশন সহ
                </span>
              </button>

              {/* Text Mode */}
              <button
                type="button"
                onClick={() => setCurrent({ ...current, mode: 'text' })}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  current.mode === 'text'
                    ? 'border-slate-700 bg-slate-100 dark:bg-slate-800 ring-2 ring-slate-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${current.mode === 'text' ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                      <FileText className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">শুধু টেক্সট (Text Only)</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    কোনো চিত্র স্ক্যান হবে না, শুধুমাত্র বিশুদ্ধ টেক্সট নেওয়া হবে। সুপার ফাস্ট।
                  </p>
                </div>
                <span className="inline-block mt-3 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                  সবচেয়ে দ্রুত ও লাইটওয়েট
                </span>
              </button>
            </div>
          </div>

          {/* 5. Smart Spacing (ON / OFF) */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/30">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    ৫. স্মার্ট স্পেসিং (Smart Spacing)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                    {current.smartSpacing !== false ? 'চালু (ON)' : 'বন্ধ (OFF)'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  পিডিএফ পৃষ্ঠার কৃত্রিম গ্যাপ ও বিচ্ছিন্ন বাক্য স্বয়ংক্রিয়ভাবে যুক্ত করে এবং অধ্যায়, শিরোনাম, কবিতা ও অনুচ্ছেদের আসল ব্যবধান অক্ষুণ্ণ রাখে।
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setCurrent({ ...current, smartSpacing: true })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    current.smartSpacing !== false
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  ON (চালু)
                </button>
                <button
                  type="button"
                  onClick={() => setCurrent({ ...current, smartSpacing: false })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    current.smartSpacing === false
                      ? 'bg-slate-700 text-white shadow-2xs'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  OFF (বন্ধ)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            বাতিল
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>সেটিংস প্রয়োগ করুন</span>
          </button>
        </div>
      </div>
    </div>
  );
};
