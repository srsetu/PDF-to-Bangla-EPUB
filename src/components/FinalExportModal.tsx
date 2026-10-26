import React, { useState } from 'react';
import { BookDetails, PageItem, StructureConfig, PdfOutlineItem } from '../types';
import {
  generateEpubBlob,
  markdownToXhtml,
  isTableOfContentsText,
  isLikelyTocPage,
  buildUniversalDocumentTree,
  generateVisualTocHtml,
  detectDocumentLanguage,
  getTocTitleForLanguage,
  correctBengaliMixedScriptText,
} from '../utils/epubGenerator';
import { extractAuthoritativeTocTree } from '../utils/tocExtractor';
import {
  Download,
  BookOpen,
  Image as ImageIcon,
  Upload,
  Check,
  X,
  FileText,
  Sliders,
  Type,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ListOrdered,
} from 'lucide-react';

interface FinalExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialBookDetails: BookDetails;
  pages: PageItem[];
  coverPageIndex: number;
  onSelectCoverPage: (index: number) => void;
  customCoverBase64: string | null;
  onSetCustomCover: (base64: string | null) => void;
  structureConfig?: StructureConfig;
  pdfOutline?: PdfOutlineItem[];
}

export const FinalExportModal: React.FC<FinalExportModalProps> = ({
  isOpen,
  onClose,
  initialBookDetails,
  pages,
  coverPageIndex,
  onSelectCoverPage,
  customCoverBase64,
  onSetCustomCover,
  structureConfig,
  pdfOutline,
}) => {
  const [bookDetails, setBookDetails] = useState<BookDetails>(initialBookDetails);
  const [coverSource, setCoverSource] = useState<'page' | 'upload'>('page');
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'meta' | 'reader'>('meta');

  // Synchronize bookDetails when modal opens or initialBookDetails changes
  React.useEffect(() => {
    if (isOpen) {
      setBookDetails(initialBookDetails);
    }
  }, [isOpen, initialBookDetails]);

  // Reader Simulator State
  const [readerPageIndex, setReaderPageIndex] = useState(0);
  const [readerFontSize, setReaderFontSize] = useState(18);
  const [readerTheme, setReaderTheme] = useState<'light' | 'sepia' | 'dark'>('light');
  const [selectedFont, setSelectedFont] = useState<'noto' | 'kalpurush' | 'solaiman' | 'siliguri'>('noto');
  const [exportError, setExportError] = useState<string | null>(null);
  const [isViewingToc, setIsViewingToc] = useState(false);

  const validPages = React.useMemo(
    () => pages.filter((p) => p.status !== 'excluded' && p.markdown.trim().length > 0),
    [pages]
  );
  const page1 = pages[0];

  const docLang = React.useMemo(() => detectDocumentLanguage(pages, bookDetails), [pages, bookDetails]);
  const tocTitle = React.useMemo(() => getTocTitleForLanguage(docLang), [docLang]);
  const tocExtraction = React.useMemo(() => {
    return extractAuthoritativeTocTree(validPages, {
      pdfOutline,
      structureConfig,
      bookDetails,
    });
  }, [validPages, pdfOutline, structureConfig, bookDetails]);

  const tocTree = tocExtraction.tree;
  const tocDiagnostics = tocExtraction.diagnostics;

  if (!isOpen) return null;

  // Resolve cover photo
  const currentCoverUrl =
    coverSource === 'upload' && customCoverBase64
      ? customCoverBase64
      : pages[coverPageIndex]?.thumbnailUrl || pages[coverPageIndex]?.fullImageUrl || page1?.fullImageUrl || null;

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        onSetCustomCover(reader.result as string);
        setCoverSource('upload');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownloadEpub = async () => {
    if (!bookDetails.title || !bookDetails.title.trim()) {
      setExportError('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম লিখুন।');
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await generateEpubBlob(
        bookDetails,
        pages,
        currentCoverUrl,
        selectedFont,
        structureConfig,
        pdfOutline
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('EPUB Export error:', err);
      setExportError('ইপাব ফাইল তৈরিতে সমস্যা হয়েছে: ' + (err.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!bookDetails.title || !bookDetails.title.trim()) {
      setExportError('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম লিখুন।');
      return;
    }

    const combinedMarkdown = validPages
      .map(
        (p) =>
          `<!-- পৃষ্ঠা ${p.pageNumber} -->\n\n${correctBengaliMixedScriptText(p.markdown, {
            bookDetails,
          })}\n\n---\n`
      )
      .join('\n');
    const blob = new Blob([combinedMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${correctBengaliMixedScriptText(bookDetails.title || 'bangla_book')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeReaderPage = validPages[readerPageIndex] || validPages[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92dvh] text-slate-800 dark:text-slate-100 transition-colors">
        {/* Top Header */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/70 dark:bg-slate-950/80">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-xl flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">
                ইপাব (.epub) প্যাকেজিং ও প্রিভিউ
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                বইয়ের মেটাডেটা, প্রচ্ছদ নিশ্চিত করুন এবং EPUB 3 ডাউনলোড করুন
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab switch */}
            <div className="bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg flex items-center text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('meta')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'meta'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                মেটাডেটা ও কাভার
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('reader')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'reader'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                রিডার প্রিভিউ
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-6 overflow-y-auto flex-1">
          {activeTab === 'meta' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Left Column: Cover Selection */}
              <div className="md:col-span-5 flex flex-col items-center">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2 self-start">
                  বইয়ের প্রচ্ছদ ছবি (Cover Photo)
                </label>

                <div className="w-48 h-64 bg-slate-100 dark:bg-slate-800 rounded-xl border-2 border-slate-300 dark:border-slate-700 shadow-md overflow-hidden relative group flex items-center justify-center">
                  {currentCoverUrl ? (
                    <img
                      src={currentCoverUrl}
                      alt="Cover"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <div className="text-center p-4 text-xs text-slate-400">
                      কোনো কাভার ছবি নির্বাচিত নেই
                    </div>
                  )}
                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                    <span className="text-[11px] text-white bg-slate-800/80 px-2 py-1 rounded">
                      ইপাব প্রচ্ছদ
                    </span>
                  </div>
                </div>

                {/* Cover Source Buttons: 1st Page vs Custom Image */}
                <div className="w-full space-y-2.5 mt-4">
                  <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    প্রচ্ছদ উৎস নির্বাচন:
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setCoverSource('page');
                        onSelectCoverPage(0);
                      }}
                      className={`py-2.5 px-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 ${
                        coverSource === 'page'
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold shadow-2xs'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                      title="পিডিএফ বইয়ের প্রথম পাতাকে প্রচ্ছদ ছবি হিসেবে ব্যবহার করুন"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>১ম পৃষ্ঠা প্রচ্ছদ</span>
                    </button>

                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCustomUpload}
                        className="hidden"
                      />
                      <div
                        className={`py-2.5 px-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 ${
                          coverSource === 'upload' && customCoverBase64
                            ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold shadow-2xs'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                        title="কম্পিউটার থেকে যেকোনো কাস্টম কভার ছবি আপলোড করুন"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>কাস্টম ছবি আপলোড</span>
                      </div>
                    </label>
                  </div>

                  {coverSource === 'upload' && customCoverBase64 && (
                    <div className="flex items-center justify-between text-[11px] bg-indigo-50/70 dark:bg-indigo-950/40 p-2 rounded-lg border border-indigo-200 dark:border-indigo-800/60">
                      <span className="text-indigo-700 dark:text-indigo-300 font-medium">✓ কাস্টম প্রচ্ছদ ছবি যুক্ত হয়েছে</span>
                      <button
                        type="button"
                        onClick={() => {
                          onSetCustomCover(null);
                          setCoverSource('page');
                          onSelectCoverPage(0);
                        }}
                        className="text-rose-600 hover:underline font-bold"
                      >
                        রিমুভ করুন
                      </button>
                    </div>
                  )}

                  {coverSource === 'page' && pages.length > 1 && (
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                      <span>অন্য কোনো পৃষ্ঠা প্রচ্ছদ করতে চান?</span>
                      <select
                        value={coverPageIndex}
                        onChange={(e) => onSelectCoverPage(parseInt(e.target.value, 10))}
                        className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        {pages.map((p, idx) => (
                          <option key={p.pageNumber} value={idx}>
                            পৃষ্ঠা {p.pageNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Metadata inputs */}
              <div className="md:col-span-7 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    বইয়ের নাম (Book Title) <span className="text-rose-500 font-bold">* (আবশ্যক)</span>
                  </label>
                  <input
                    type="text"
                    value={bookDetails.title}
                    onChange={(e) => {
                      setBookDetails({ ...bookDetails, title: e.target.value });
                      if (e.target.value.trim() && exportError?.includes('বইয়ের নাম')) {
                        setExportError(null);
                      }
                    }}
                    placeholder="বইয়ের পুরো নাম লিখুন..."
                    className={`w-full px-3.5 py-2 rounded-xl border bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none font-medium transition-colors ${
                      !bookDetails.title.trim() && exportError?.includes('বইয়ের নাম')
                        ? 'border-rose-500 focus:ring-2 focus:ring-rose-500 bg-rose-50/30 dark:bg-rose-950/20'
                        : 'border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500'
                    }`}
                  />
                  {!bookDetails.title.trim() && exportError?.includes('বইয়ের নাম') ? (
                    <p className="text-xs text-rose-500 font-medium mt-1">
                      বইয়ের নাম আবশ্যক, অনুগ্রহ করে নাম লিখুন
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      প্রয়োজনমতো বইয়ের নাম পরিবর্তন (রিনেম) করতে পারেন
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                      লেখক (Author)
                    </label>
                    <input
                      type="text"
                      value={bookDetails.author}
                      onChange={(e) => setBookDetails({ ...bookDetails, author: e.target.value })}
                      placeholder="লেখকের নাম..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
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
                      placeholder="প্রকাশকের নাম..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                      ধরণ (Genre)
                    </label>
                    <input
                      type="text"
                      value={bookDetails.genre}
                      onChange={(e) => setBookDetails({ ...bookDetails, genre: e.target.value })}
                      placeholder="যেমন: উপন্যাস, কবিতা..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                      প্রকাশকাল বা বছর
                    </label>
                    <input
                      type="text"
                      value={bookDetails.publishYear || ''}
                      onChange={(e) => setBookDetails({ ...bookDetails, publishYear: e.target.value })}
                      placeholder="যেমন: ১৯২৪..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    বইয়ের বিবরণ (Description)
                  </label>
                  <textarea
                    rows={2}
                    value={bookDetails.description || ''}
                    onChange={(e) => setBookDetails({ ...bookDetails, description: e.target.value })}
                    placeholder="বই সম্পর্কে ২-৩ লাইনের সংক্ষিপ্ত বর্ণনা..."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>

                {/* EPUB Default Font Family Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>ইপাব ডিফল্ট ফন্ট (Default Font Stack)</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { id: 'noto', label: 'নাতো সানস বাঙালি', desc: 'Google Noto Sans Bengali (সর্বাধুনিক ও স্পষ্ট)' },
                      { id: 'kalpurush', label: 'কালপুরুষ (Kalpurush)', desc: 'ক্লাসিক বাংলা লিটারেচার ফন্ট' },
                      { id: 'solaiman', label: 'সুলাইমানলিপি', desc: 'ঐতিহ্যবাহী স্ট্যান্ডার্ড বাংলা ফন্ট' },
                      { id: 'siliguri', label: 'হিন্দ সিলিগুড়ি', desc: 'ক্লিন ও আধুনিক স্ক্রিন ফন্ট' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFont(f.id as any)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          selectedFont === f.id
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/70 text-indigo-950 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center justify-between">
                          <span>{f.label}</span>
                          {selectedFont === f.id && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{f.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/70 rounded-xl text-xs text-indigo-950 dark:text-indigo-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>ইপাব ফাইল ইনফো</span>
                  </div>
                  <div>
                    • মোট অন্তর্ভুক্ত পৃষ্ঠা: <strong>{validPages.length}</strong> টি।
                  </div>
                  <div>
                    • নির্বাচিত ফন্ট: <strong>{selectedFont === 'noto' ? 'নাতো সানস বাঙালি' : selectedFont === 'kalpurush' ? 'কালপুরুষ' : selectedFont === 'solaiman' ? 'সুলাইমানলিপি' : 'হিন্দ সিলিগুড়ি'}</strong>।
                  </div>
                  <div>
                    • স্ট্যান্ডার্ড: <strong>EPUB 3.0 + EPUB 2 NCX ডুয়াল ইঞ্জিন</strong> (UTF-8 ও বাংলা ফন্ট)।
                  </div>
                  <div>
                    • বিস্তারিত সূচিপত্র:{' '}
                    <strong>
                      {tocDiagnostics.outlineFound
                        ? `পিডিএফ আউটলাইন থেকে ${tocDiagnostics.validatedEntriesCount}টি এন্ট্রি গৃহীত`
                        : !tocDiagnostics.fallbackUsed
                        ? `মূল সূচিপত্র থেকে ${tocDiagnostics.validatedEntriesCount}টি এন্ট্রি সরাসরি উদ্ধারকৃত (নির্ভুল ক্রমানুসারে)`
                        : `চ্যাপ্টার হেডিংভিত্তিক ফলব্যাক নেভিগেশন (${tocDiagnostics.validatedEntriesCount}টি অধ্যায়)`}
                    </strong>
                  </div>
                  <div>
                    • সর্বোচ্চ কম্প্যাটিবিলিটি: <strong>Amazon Kindle</strong> (Send-to-Kindle/KDP), <strong>Apple Books</strong>, <strong>Google Play Books</strong>, <strong>Kobo</strong>, <strong>Moon+ Reader</strong>, <strong>Calibre</strong>, <strong>ReadEra</strong>, <strong>Lithium</strong> সহ সকল ই-রিডার ডিভাইসে ১০০% রেডি।
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reader Simulator Tab */}
          {activeTab === 'reader' && (
            <div className="space-y-4">
              {/* Reader Controls */}
              <div className="flex flex-wrap items-center justify-between p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs gap-2">
                {/* Page switcher & TOC shortcut */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setIsViewingToc(false);
                      setReaderPageIndex((i) => Math.max(0, i - 1));
                    }}
                    disabled={isViewingToc || readerPageIndex === 0}
                    className="p-1.5 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 shadow-2xs disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {isViewingToc
                      ? `${tocTitle} (ইপাব সূচিপত্র প্রিভিউ)`
                      : `অধ্যায় / পাতা ${readerPageIndex + 1} / ${validPages.length} (পৃষ্ঠা ${activeReaderPage?.pageNumber})`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsViewingToc(false);
                      setReaderPageIndex((i) => Math.min(validPages.length - 1, i + 1));
                    }}
                    disabled={isViewingToc || readerPageIndex >= validPages.length - 1}
                    className="p-1.5 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 shadow-2xs disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  {/* Universal TOC toggle button */}
                  <button
                    type="button"
                    onClick={() => setIsViewingToc(!isViewingToc)}
                    className={`ml-1 px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                      isViewingToc
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
                    }`}
                    title="বইয়ের সূচিপত্র খুলুন এবং যেকোনো অধ্যায়ে জাম্প করুন"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span>{tocTitle}</span>
                  </button>
                </div>

                {/* Font Selector in Reader */}
                <div className="flex items-center gap-1 bg-white dark:bg-slate-700 p-0.5 rounded-lg border border-slate-200 dark:border-slate-600 text-[10.5px]">
                  <button
                    type="button"
                    onClick={() => setSelectedFont('noto')}
                    className={`px-2 py-0.5 rounded ${selectedFont === 'noto' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    নাতো সানস
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFont('kalpurush')}
                    className={`px-2 py-0.5 rounded ${selectedFont === 'kalpurush' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    কালপুরুষ
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFont('solaiman')}
                    className={`px-2 py-0.5 rounded ${selectedFont === 'solaiman' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    সুলাইমান
                  </button>
                </div>

                {/* Font Size & Theme */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-white dark:bg-slate-700 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600">
                    <button
                      type="button"
                      onClick={() => setReaderFontSize((s) => Math.max(14, s - 2))}
                      className="font-bold px-1.5 hover:text-indigo-600 dark:text-slate-200"
                    >
                      A-
                    </button>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-300">{readerFontSize}px</span>
                    <button
                      type="button"
                      onClick={() => setReaderFontSize((s) => Math.min(28, s + 2))}
                      className="font-bold px-1.5 hover:text-indigo-600 dark:text-slate-200"
                    >
                      A+
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setReaderTheme('light')}
                      className={`w-6 h-6 rounded-full border ${readerTheme === 'light' ? 'ring-2 ring-indigo-500' : ''} bg-white border-slate-300`}
                      title="সাদা"
                    />
                    <button
                      type="button"
                      onClick={() => setReaderTheme('sepia')}
                      className={`w-6 h-6 rounded-full border ${readerTheme === 'sepia' ? 'ring-2 ring-indigo-500' : ''} bg-[#FBF0D9] border-amber-300`}
                      title="বাদামী (Sepia)"
                    />
                    <button
                      type="button"
                      onClick={() => setReaderTheme('dark')}
                      className={`w-6 h-6 rounded-full border ${readerTheme === 'dark' ? 'ring-2 ring-indigo-500' : ''} bg-slate-900 border-slate-700`}
                      title="ডার্ক মোড"
                    />
                  </div>
                </div>
              </div>

              {/* Reader Simulation Window */}
              <div
                id="reader-content-window"
                onClick={(e) => {
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

                  if (targetPageNum !== null) {
                    e.preventDefault();
                    const targetIdx = validPages.findIndex((p) => p.pageNumber === targetPageNum);
                    if (targetIdx !== -1) {
                      setIsViewingToc(false);
                      setReaderPageIndex(targetIdx);
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
                        }, 120);
                      }
                    }
                  }
                }}
                className={`p-3.5 sm:p-8 rounded-2xl border shadow-inner max-h-[50vh] overflow-y-auto transition-colors ${
                  readerTheme === 'sepia'
                    ? 'bg-[#FBF0D9] text-[#433422] border-amber-200'
                    : readerTheme === 'dark'
                    ? 'bg-slate-900 text-slate-100 border-slate-800'
                    : 'bg-white text-slate-900 border-slate-200'
                }`}
                style={{
                  fontSize: `${readerFontSize}px`,
                  lineHeight: 1.85,
                  fontFamily:
                    selectedFont === 'noto'
                      ? '"Noto Sans Bengali", sans-serif'
                      : selectedFont === 'kalpurush'
                      ? '"Kalpurush", serif'
                      : selectedFont === 'solaiman'
                      ? '"SolaimanLipi", serif'
                      : '"Hind Siliguri", sans-serif',
                }}
              >
                {isViewingToc ? (
                  <div
                    className="prose max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: generateVisualTocHtml(tocTree, bookDetails.title, bookDetails.author, docLang),
                    }}
                  />
                ) : activeReaderPage ? (
                  <div
                    className="prose max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: markdownToXhtml(activeReaderPage.markdown, activeReaderPage.figures, {
                        isPreview: true,
                        pageNumber: activeReaderPage.pageNumber,
                        isTocPage: isLikelyTocPage(activeReaderPage, validPages),
                        allPages: validPages,
                      }),
                    }}
                  />
                ) : (
                  <div className="text-center py-12 text-slate-400">কোনো পাতা নেই</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            <span>মার্কডাউন (.md) সংরক্ষণ</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadEpub}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-950 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'ইপাব প্যাকেজিং হচ্ছে...' : 'ইপাব (.epub) ডাউনলোড করুন'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
