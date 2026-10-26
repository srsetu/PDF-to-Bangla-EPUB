/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Files, Eye, Edit3, AlertCircle } from 'lucide-react';
import {
  BookDetails,
  StructureConfig,
  WatermarkConfig,
  ConversionSettings,
  PageItem,
  ProcessingState,
  PdfOutlineItem,
  OcrValidationReport,
} from './types';
import { Header } from './components/Header';
import { FileUploadStep } from './components/FileUploadStep';
import { PromptSegmentsModal } from './components/PromptSegmentsModal';
import { ModelSettingsModal } from './components/ModelSettingsModal';
import { PageListSidebar } from './components/PageListSidebar';
import { CenterProcessPanel } from './components/CenterProcessPanel';
import { RightEditorPanel } from './components/RightEditorPanel';
import { FinalExportModal } from './components/FinalExportModal';
import { KeyPoolModal } from './components/KeyPoolModal';
import {
  loadPdfDocument,
  renderPageToDataUrl,
  renderPageAndThumbnail,
  cropFigureFromPage,
  extractStrictPageImages,
} from './utils/pdfRenderer';
import {
  SAMPLE_BOOK_META,
  SAMPLE_PAGES,
  renderSamplePageToCanvas,
} from './utils/samplePdf';
import { formatFriendlyErrorMessage } from './utils/errorHelper';
import { isTableOfContentsText } from './utils/epubGenerator';
import { validateAndCorrectBengaliOcr } from './utils/bengaliOcrPipeline';

export default function App() {
  // Theme state with localStorage persistence
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('bangla_epub_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('bangla_epub_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Step 1: Upload, Step 4: Workspace with Config/Settings
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Mobile Workspace active view tab: 'pages' | 'preview' | 'editor'
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<'pages' | 'preview' | 'editor'>('preview');

  // Resizable Panels State (with persistent memory)
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bangla_epub_left_width');
      return saved ? parseInt(saved, 10) : 280;
    } catch {
      return 280;
    }
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bangla_epub_right_width');
      return saved ? parseInt(saved, 10) : 560;
    } catch {
      return 560;
    }
  });

  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  const handleResetLayout = () => {
    setLeftWidth(280);
    setRightWidth(560);
    try {
      localStorage.removeItem('bangla_epub_left_width');
      localStorage.removeItem('bangla_epub_right_width');
      localStorage.removeItem('bangla_epub_editor_height');
    } catch {
      // ignore
    }
  };

  // Window mouse drag listeners for resizable dividers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        // Clamp left sidebar width between 180px and 480px
        const newWidth = Math.max(180, Math.min(480, e.clientX));
        setLeftWidth(newWidth);
        try {
          localStorage.setItem('bangla_epub_left_width', String(newWidth));
        } catch {}
      } else if (isDraggingRight) {
        // Clamp right panel width between 340px and 960px
        const newWidth = Math.max(340, Math.min(960, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
        try {
          localStorage.setItem('bangla_epub_right_width', String(newWidth));
        } catch {}
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    if (isDraggingLeft || isDraggingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
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
  }, [isDraggingLeft, isDraggingRight]);

  // Loaded PDF Doc reference
  const pdfDocRef = useRef<any>(null);

  // Pages state
  const [pages, setPages] = useState<PageItem[]>([]);
  const pagesRef = useRef<PageItem[]>(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [coverPageIndex, setCoverPageIndex] = useState<number>(0);
  const [customCoverBase64, setCustomCoverBase64] = useState<string | null>(null);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);

  // Segment 1: Book Details
  const [bookDetails, setBookDetails] = useState<BookDetails>({
    title: '',
    author: '',
    publisher: '',
    genre: 'উপন্যাস',
    publishYear: '',
    description: '',
  });

  // Segment 2: Structure & Exclusions
  const [structureConfig, setStructureConfig] = useState<StructureConfig>({
    bookType: 'single',
    hasPrintedToc: true,
    includeTocInEpub: true,
    excludedPagesStr: '',
    excludedPagesList: [],
    tocPagesStr: '',
  });

  // Segment 3: Watermarks & Cleanup
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>({
    filters: ['www.amarboi.com', 'Scan by CamScanner', 'TapScanner'],
    removeHeaderFooter: true,
    trimMarginArtifacts: true,
  });

  // Conversion Settings (AI Model, Language, Batch, Mode)
  const [conversionSettings, setConversionSettings] = useState<ConversionSettings>({
    model: 'LTGB',
    language: 'bn',
    batchSize: 2,
    mode: 'smart',
  });

  // Processing State & Monitor
  const [processingState, setProcessingState] = useState<ProcessingState>({
    isConverting: false,
    currentPageNumber: null,
    currentPhase: 'idle',
    completedCount: 0,
    totalCount: 0,
    logMessages: [],
  });

  // Cancellation ref for pausing
  const isCancelledRef = useRef<boolean>(false);
  const hasAutoOpenedExportRef = useRef<boolean>(false);

  // Live Auto-follow Tracking (Auto-shifts Middle & Left panels to active scanning page)
  const [isLiveTracking, setIsLiveTracking] = useState<boolean>(false);

  // Scanning Elapsed Time Counter
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Elapsed Timer Effect: counts seconds while converting
  useEffect(() => {
    if (processingState.isConverting) {
      if (!timerIntervalRef.current) {
        timerIntervalRef.current = setInterval(() => {
          setElapsedSeconds((prev) => prev + 1);
        }, 1000);
      }
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [processingState.isConverting]);

  // Live Auto-Follow Effect: whenever a new page starts scanning, automatically shift both Middle and Left panels
  useEffect(() => {
    if (isLiveTracking && processingState.isConverting && processingState.currentPageNumber !== null) {
      const liveIdx = pages.findIndex((p) => p.pageNumber === processingState.currentPageNumber);
      if (liveIdx !== -1 && liveIdx !== selectedPageIndex) {
        setSelectedPageIndex(liveIdx);
      }
    }
  }, [processingState.currentPageNumber, isLiveTracking, processingState.isConverting, pages, selectedPageIndex]);

  // Modals state
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isKeyPoolModalOpen, setIsKeyPoolModalOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<{ index: number; pageNumber: number } | null>(null);
  const [keyPoolStatus, setKeyPoolStatus] = useState<{ totalKeys: number; rpmCapacity: number }>({
    totalKeys: 1,
    rpmCapacity: 15,
  });

  const fetchKeyPoolStatus = async () => {
    try {
      // 1. Check local storage for persistent keys
      let localKeys: string[] = [];
      try {
        const stored = localStorage.getItem('bangla_epub_gemini_keys');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localKeys = parsed.filter(
              (k) => typeof k === 'string' && k.trim().length > 10
            );
          }
        }
      } catch (err) {
        console.warn('Failed to parse localStorage keys:', err);
      }

      // 2. Sync to server if local keys exist, otherwise get server status
      let res;
      if (localKeys.length > 0) {
        res = await fetch('/api/key-pool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: localKeys }),
        });
      } else {
        res = await fetch('/api/key-pool');
      }

      if (res && res.ok) {
        const data = await res.json();
        setKeyPoolStatus({
          totalKeys: data.totalKeys || 1,
          rpmCapacity: data.totalCapacityRpm || 15,
        });

        // Sync validated server-stored keys back to localStorage (clean any quarantined keys)
        if (Array.isArray(data.customKeys)) {
          localStorage.setItem('bangla_epub_gemini_keys', JSON.stringify(data.customKeys));
        }

        // Auto-scale recommended batch size to 5 if multiple keys are available and default was 2
        if ((data.totalKeys || 1) >= 3) {
          setConversionSettings((prev) => ({
            ...prev,
            batchSize: prev.batchSize === 2 ? 5 : Math.max(1, Math.min(5, prev.batchSize)),
          }));
        }
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchKeyPoolStatus();
  }, []);

  // Automatically pop up EPUB Export Modal as soon as all non-skipped pages are completed
  useEffect(() => {
    if (pages.length === 0) {
      hasAutoOpenedExportRef.current = false;
      return;
    }

    const eligiblePages = pages.filter((p) => p.status !== 'excluded');
    const allDone =
      eligiblePages.length > 0 &&
      eligiblePages.every((p) => p.status === 'completed');

    if (allDone && !processingState.isConverting && !hasAutoOpenedExportRef.current) {
      hasAutoOpenedExportRef.current = true;
      const timer = setTimeout(() => {
        setIsExportModalOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    } else if (!allDone) {
      hasAutoOpenedExportRef.current = false;
    }
  }, [pages, processingState.isConverting]);

  // Helper to get exact current completed count
  const syncCompletedCount = () => {
    return pagesRef.current.filter((p) => p.status === 'completed').length;
  };

  // Handle uploaded PDF file
  const handleFileSelected = async (file: File) => {
    setIsLoadingPdf(true);
    setLoadingMessage('পিডিএফ ফাইল লোড ও বিশ্লেষণ হচ্ছে...');
    try {
      const loaded = await loadPdfDocument(file);
      pdfDocRef.current = loaded.doc;
      setPdfOutline(loaded.outline || []);

      // Strip extension, replace hyphens and underscores with spaces, collapse spaces
      const cleanTitle = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // By default, auto-populate the uploaded file name as the book title (can be renamed anytime)
      setBookDetails((prev) => ({
        ...prev,
        title: cleanTitle || 'আমার বাংলা বই',
      }));

      const totalPages = loaded.numPages;
      const initialPages: PageItem[] = new Array(totalPages);
      const chunkSize = 3;

      for (let i = 1; i <= totalPages; i += chunkSize) {
        const batchPages = Array.from(
          { length: Math.min(chunkSize, totalPages - i + 1) },
          (_, k) => i + k
        );
        const endPage = batchPages[batchPages.length - 1];
        setLoadingMessage(
          `পৃষ্ঠা ${batchPages[0]}${batchPages.length > 1 ? `–${endPage}` : ''} / ${totalPages} দ্রুত বিশ্লেষণ হচ্ছে...`
        );

        const results = await Promise.all(
          batchPages.map((pNum) => renderPageAndThumbnail(loaded.doc, pNum, 1.35, 0.85))
        );

        results.forEach((res, idx) => {
          const pageNum = batchPages[idx];
          initialPages[pageNum - 1] = {
            pageNumber: pageNum,
            status: 'pending',
            thumbnailUrl: res.thumbDataUrl,
            fullImageUrl: res.fullDataUrl,
            markdown: '',
            originalOcr: '',
            figures: [],
            isTocPage: false,
            hasImages: Boolean(res.hasImages),
            layoutBlocks: res.layoutBlocks,
            columnCount: res.columnCount,
          };
        });
      }

      setPages(initialPages);
      setSelectedPageIndex(0);
      setCoverPageIndex(0);
      setProcessingState({
        isConverting: false,
        currentPageNumber: null,
        currentPhase: 'idle',
        totalCount: totalPages,
        completedCount: 0,
        logMessages: [`পিডিএফ সফলভাবে লোড হয়েছে। মোট পৃষ্ঠা: ${totalPages}`],
      });

      setCurrentStep(4);
      setIsConfigModalOpen(true);
    } catch (err: any) {
      console.error('PDF Load Error:', err);
      alert('পিডিএফ ফাইল পড়তে সমস্যা হয়েছে: ' + (err.message || 'Unknown error'));
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Handle 1-click Sample Bengali Book
  const handleLoadSampleBook = async () => {
    setIsLoadingPdf(true);
    setLoadingMessage('নমুনা বাংলা বই (রক্তকরবী) তৈরি হচ্ছে...');
    try {
      setBookDetails(SAMPLE_BOOK_META);
      setWatermarkConfig({
        filters: ['www.amarboi.com', 'Scan by CamScanner Free'],
        removeHeaderFooter: true,
        trimMarginArtifacts: true,
      });

      const samplePageItems: PageItem[] = [];

      for (let i = 0; i < SAMPLE_PAGES.length; i++) {
        const pData = SAMPLE_PAGES[i];
        setLoadingMessage(`নমুনা পৃষ্ঠা ${pData.pageNumber} রেন্ডার হচ্ছে...`);
        const imgUrl = await renderSamplePageToCanvas(pData);

        samplePageItems.push({
          pageNumber: pData.pageNumber,
          status: 'pending',
          thumbnailUrl: imgUrl,
          fullImageUrl: imgUrl,
          markdown: '',
          originalOcr: '',
          figures: [],
          isTocPage: pData.pageNumber === 2,
          hasImages: Boolean(pData.hasIllustration),
        });
      }

      setPages(samplePageItems);
      setSelectedPageIndex(0);
      setCoverPageIndex(0);
      setProcessingState({
        isConverting: false,
        currentPageNumber: null,
        currentPhase: 'idle',
        totalCount: samplePageItems.length,
        completedCount: 0,
        logMessages: ['নমুনা বাংলা বই (রক্তকরবী) সফলভাবে প্রস্তুত হয়েছে।'],
      });

      setCurrentStep(4);
      setIsConfigModalOpen(true);
    } catch (err: any) {
      console.error('Sample Book Error:', err);
      alert('নমুনা বই তৈরিতে সমস্যা: ' + err.message);
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Process a single page with Gemini Vision API with Smart Dynamic Mode and Automatic Resilient Retry
  const performOcrOnPage = async (
    page: PageItem,
    retryAttempt: number = 0
  ): Promise<{
    markdown: string;
    rawOcr: string;
    ocrValidation: OcrValidationReport;
    figures: any[];
    appliedMode: 'smart' | 'text' | 'image';
  }> => {
    if (!page.fullImageUrl) {
      throw new Error(`পৃষ্ঠা ${page.pageNumber} এর ছবি অনুপস্থিত।`);
    }

    const currentMode = conversionSettings.mode || 'smart';

    // Read any custom keys stored in browser localStorage to ensure multi-key throughput
    let storedKeys: string[] = [];
    try {
      const raw = localStorage.getItem('bangla_epub_gemini_keys');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          storedKeys = parsed.filter((k) => typeof k === 'string' && k.trim().length > 10);
        }
      }
    } catch {}

    try {
      const res = await fetch('/api/ocr-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: page.fullImageUrl,
          pageNumber: page.pageNumber,
          totalPages: pages.length,
          bookDetails,
          layoutConfig: structureConfig,
          watermarkFilters: watermarkConfig.filters,
          modelChoice: conversionSettings.model,
          language: conversionSettings.language,
          mode: currentMode,
          hasImages: page.hasImages,
          customKeys: storedKeys,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const rawMsg = errData?.error || `সার্ভার সমস্যা: স্ট্যাটাস ${res.status}`;
        const isQuotaOrTransient =
          res.status === 429 ||
          res.status === 503 ||
          res.status === 500 ||
          rawMsg.includes('429') ||
          rawMsg.includes('503') ||
          rawMsg.includes('quota') ||
          rawMsg.includes('rate') ||
          rawMsg.includes('resource_exhausted') ||
          rawMsg.includes('সাময়িক ত্রুটি') ||
          rawMsg.includes('পুনরায় চেষ্টা');

        // Client-Side Resilient Retry: up to 3 attempts with progressive backoff before failing
        if (isQuotaOrTransient && retryAttempt < 3 && !isCancelledRef.current) {
          const backoffDelay = (retryAttempt + 1) * 3500;
          setProcessingState((prev) => ({
            ...prev,
            logMessages: [
              ...prev.logMessages,
              `পৃষ্ঠা ${page.pageNumber}: কোটা/লোড সমন্বয় করে ${Math.ceil(backoffDelay / 1000)}s পর পুনরায় স্বয়ংক্রিয় চেষ্টা হচ্ছে (চেষ্টা #${retryAttempt + 1}/3)...`,
            ],
          }));
          await new Promise((r) => setTimeout(r, backoffDelay));
          if (isCancelledRef.current) {
            throw new Error('ব্যবহারকারী কর্তৃক রূপান্তর বিরতি দেওয়া হয়েছে।');
          }
          return await performOcrOnPage(page, retryAttempt + 1);
        }

        const friendly = formatFriendlyErrorMessage(rawMsg);
        throw new Error(friendly);
      }

      const data = await res.json();
      let figuresWithImages: any[] = [];

      // In smart mode or image mode, extract images with strict precision:
      // Direct embedded PDF object extraction first, precision boundary detection fallback
      if (currentMode !== 'text') {
        try {
          figuresWithImages = await extractStrictPageImages(
            pdfDocRef.current,
            page.pageNumber,
            page.fullImageUrl || '',
            data.figures || []
          );
        } catch (imgErr) {
          console.warn('Strict image extraction fallback:', imgErr);
          if (data.figures?.length > 0) {
            for (const fig of data.figures) {
              try {
                const cropped = await cropFigureFromPage(
                  page.fullImageUrl,
                  fig.top ?? 20,
                  fig.left ?? 10,
                  fig.width ?? 80,
                  fig.height ?? 30,
                  fig.type
                );
                figuresWithImages.push({
                  ...fig,
                  imageUrl: cropped,
                  dataUrl: cropped,
                });
              } catch {
                figuresWithImages.push(fig);
              }
            }
          }
        }
      }

      const rawOcrText = data.rawOcr ?? data.markdown ?? '';
      const clientValidation = validateAndCorrectBengaliOcr(data.markdown || '', {
        language: conversionSettings.language,
        bookDetails,
      });

      const finalValidation: OcrValidationReport = data.ocrValidation || clientValidation.validationReport;

      return {
        markdown: clientValidation.correctedText,
        rawOcr: rawOcrText,
        ocrValidation: finalValidation,
        figures: figuresWithImages,
        appliedMode: currentMode,
      };
    } catch (err: any) {
      const errMsg = String(err?.message || '');
      const isTransientErr =
        errMsg.includes('Failed to fetch') ||
        errMsg.includes('NetworkError') ||
        errMsg.includes('network') ||
        errMsg.includes('429') ||
        errMsg.includes('503');

      if (isTransientErr && retryAttempt < 3 && !isCancelledRef.current) {
        const backoffDelay = (retryAttempt + 1) * 4000;
        setProcessingState((prev) => ({
          ...prev,
          logMessages: [
            ...prev.logMessages,
            `পৃষ্ঠা ${page.pageNumber}: নেটওয়ার্ক/সার্ভার বিরতি সমন্বয় করে ${backoffDelay / 1000}s পর চেষ্টা করা হচ্ছে...`,
          ],
        }));
        await new Promise((r) => setTimeout(r, backoffDelay));
        if (isCancelledRef.current) {
          throw new Error('ব্যবহারকারী কর্তৃক রূপান্তর বিরতি দেওয়া হয়েছে।');
        }
        return await performOcrOnPage(page, retryAttempt + 1);
      }
      throw err;
    }
  };

  // Convert Single Page
  const handleProcessSinglePage = async (pageIndex: number) => {
    const targetPage = pages[pageIndex];
    if (!targetPage) return;

    if (!bookDetails.title || !bookDetails.title.trim()) {
      setIsConfigModalOpen(true);
      alert('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম নির্ধারণ করুন।');
      return;
    }

    const effectiveMode = conversionSettings.mode || 'smart';
    const modeText =
      effectiveMode === 'smart'
        ? 'স্মার্ট অটো মোড (টেক্সট + চিত্র/আইকন অটো)'
        : effectiveMode === 'image'
        ? 'চিত্র মোড'
        : 'টেক্সট মোড';

    setProcessingState((prev) => ({
      ...prev,
      currentPageNumber: targetPage.pageNumber,
      currentPhase: 'ocr',
      logMessages: [
        ...prev.logMessages,
        `পৃষ্ঠা ${targetPage.pageNumber} (${modeText}) এর ভিশন ওসিআর শুরু হয়েছে...`,
      ],
    }));

    setPages((prev) => {
      if (!prev[pageIndex]) return prev;
      const next = [...prev];
      next[pageIndex] = { ...prev[pageIndex], status: 'processing', errorMsg: undefined };
      return next;
    });

    try {
      const result = await performOcrOnPage(targetPage);
      const isToc = isTableOfContentsText(result.markdown);

      setPages((prev) => {
        const existing = prev[pageIndex];
        if (!existing) return prev;
        const next = [...prev];
        next[pageIndex] = {
          ...existing,
          status: 'completed',
          markdown: result.markdown,
          originalOcr: result.rawOcr,
          ocrValidation: result.ocrValidation,
          figures: result.figures,
          hasImages: Boolean(result.figures && result.figures.length > 0),
          isTocPage: Boolean(isToc || existing.isTocPage),
          appliedMode: result.appliedMode,
          errorMsg: undefined,
        };
        return next;
      });

      // Synchronize exact completed count
      setTimeout(() => {
        const exactCompleted = syncCompletedCount();
        const modeBadge = result.appliedMode === 'image' ? 'চিত্র সহ' : 'দ্রুত টেক্সট';
        setProcessingState((prev) => ({
          ...prev,
          currentPhase: 'complete',
          completedCount: exactCompleted,
          logMessages: [
            ...prev.logMessages,
            `পৃষ্ঠা ${targetPage.pageNumber} এর টেক্সট সফলভাবে তৈরি হয়েছে (${modeBadge})।`,
          ],
        }));

        const cur = pagesRef.current;
        const allDone =
          cur.length > 0 &&
          cur.filter((p) => p.status !== 'excluded').every((p) => p.status === 'completed');
        if (allDone) {
          setProcessingState((p) => ({
            ...p,
            logMessages: [
              ...p.logMessages,
              '🎉 অভিনন্দন! বইয়ের সমস্ত পৃষ্ঠা রূপান্তর সম্পন্ন হয়েছে। ইপাব তৈরি ও প্রিভিউ উইন্ডো ওপেন হচ্ছে...',
            ],
          }));
          setTimeout(() => {
            setIsExportModalOpen(true);
          }, 900);
        }
      }, 50);
    } catch (err: any) {
      console.error(`Page ${targetPage.pageNumber} OCR error:`, err);
      const friendlyErr = formatFriendlyErrorMessage(err?.message);
      setPages((prev) => {
        if (!prev[pageIndex]) return prev;
        const next = [...prev];
        next[pageIndex] = {
          ...prev[pageIndex],
          status: 'error',
          errorMsg: friendlyErr,
        };
        return next;
      });
      setProcessingState((prev) => ({
        ...prev,
        currentPhase: 'idle',
        completedCount: syncCompletedCount(),
        logMessages: [...prev.logMessages, `ত্রুটি: পৃষ্ঠা ${targetPage.pageNumber} (${friendlyErr})`],
      }));
    }
  };

  // Start Full Conversion (Batching with user-configured batch size, NO infinite/auto retry loops)
  const handleStartConversion = async () => {
    if (!bookDetails.title || !bookDetails.title.trim()) {
      setIsConfigModalOpen(true);
      alert('বইয়ের নাম আবশ্যক! অনুগ্রহ করে বইয়ের নাম নির্ধারণ করুন।');
      return;
    }

    isCancelledRef.current = false;
    setIsLiveTracking(true);
    setProcessingState((prev) => ({
      ...prev,
      isConverting: true,
      logMessages: [...prev.logMessages, 'বইয়ের পৃষ্ঠাগুলোর ক্রমান্বয়ে রূপান্তর শুরু হয়েছে...'],
    }));

    // Find all pending or errored eligible pages
    const eligibleIndices = pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter(({ page }) => page.status !== 'excluded' && page.status !== 'completed')
      .map(({ index }) => index);

    const activeKeysCount = Math.max(1, keyPoolStatus.totalKeys);
    // User can select 1 to 5 pages. Strictly respect user selection clamped between 1 and 5.
    const userBatch = conversionSettings.batchSize || 1;
    const batchSize = Math.max(1, Math.min(5, userBatch));

    for (let i = 0; i < eligibleIndices.length; i += batchSize) {
      if (isCancelledRef.current) {
        setProcessingState((prev) => ({
          ...prev,
          isConverting: false,
          currentPhase: 'idle',
          completedCount: syncCompletedCount(),
          logMessages: [...prev.logMessages, 'রূপান্তর বিরতি দেওয়া হয়েছে।'],
        }));
        return;
      }

      if (i > 0) {
        // Inter-batch pacing: multi-key pool with 5+ keys can proceed almost immediately
        const interBatchPacing = activeKeysCount >= 4 ? 150 : activeKeysCount >= 2 ? 400 : 1200;
        await new Promise((r) => setTimeout(r, interBatchPacing));
      }

      if (isCancelledRef.current) return;

      const batch = eligibleIndices.slice(i, i + batchSize);
      const batchPageNums = batch.map((idx) => pages[idx].pageNumber);

      setProcessingState((prev) => ({
        ...prev,
        currentPageNumber: batchPageNums[0],
        currentPhase: 'ocr',
        logMessages: [
          ...prev.logMessages,
          `একত্রে ${batch.length}টি পৃষ্ঠা (পৃষ্ঠা ${batchPageNums.join(', ')}) রূপান্তর শুরু হচ্ছে...`,
        ],
      }));

      // Mark batch pages as processing
      setPages((prev) => {
        const next = [...prev];
        batch.forEach((pageIdx) => {
          if (prev[pageIdx]) {
            next[pageIdx] = { ...prev[pageIdx], status: 'processing', errorMsg: undefined };
          }
        });
        return next;
      });

      await Promise.all(
        batch.map(async (pageIdx) => {
          if (isCancelledRef.current) return;
          const page = pages[pageIdx];
          if (!page) return;

          try {
            const pageResult = await performOcrOnPage(page);
            const isToc = isTableOfContentsText(pageResult.markdown);
            setPages((prev) => {
              const existing = prev[pageIdx];
              if (!existing) return prev;
              const next = [...prev];
              next[pageIdx] = {
                ...existing,
                status: 'completed',
                markdown: pageResult.markdown,
                originalOcr: pageResult.rawOcr,
                ocrValidation: pageResult.ocrValidation,
                figures: pageResult.figures,
                hasImages: Boolean(pageResult.figures && pageResult.figures.length > 0),
                isTocPage: Boolean(isToc || existing.isTocPage),
                appliedMode: pageResult.appliedMode,
                errorMsg: undefined,
              };
              return next;
            });
            const modeNote = pageResult.appliedMode === 'image' ? 'চিত্র সহ' : 'দ্রুত টেক্সট';
            setProcessingState((prev) => {
              // If there are other pages in this batch still processing, advance currentPageNumber
              const remainingInBatch = batch
                .map((idx) => pagesRef.current[idx])
                .filter((p) => p && p.status === 'processing');
              const nextLiveNum =
                remainingInBatch.length > 0 ? remainingInBatch[0].pageNumber : prev.currentPageNumber;
              return {
                ...prev,
                currentPageNumber: nextLiveNum,
                completedCount: syncCompletedCount() + 1,
                currentPhase: 'complete',
                logMessages: [...prev.logMessages, `পৃষ্ঠা ${page.pageNumber} সফলভাবে সম্পন্ন (${modeNote})।`],
              };
            });
          } catch (err: any) {
            const friendly = formatFriendlyErrorMessage(err?.message);
            console.error(`Error on page ${page.pageNumber}:`, friendly);
            setPages((prev) => {
              if (!prev[pageIdx]) return prev;
              const next = [...prev];
              next[pageIdx] = {
                ...prev[pageIdx],
                status: 'error',
                errorMsg: friendly,
              };
              return next;
            });
            setProcessingState((prev) => ({
              ...prev,
              completedCount: syncCompletedCount(),
              logMessages: [...prev.logMessages, `ত্রুটি: পৃষ্ঠা ${page.pageNumber} (${friendly})`],
            }));
          }
        })
      );
    }

    // Final check after all batches
    const finalPages = pagesRef.current;
    const allCompleted =
      finalPages.length > 0 &&
      finalPages.filter((p) => p.status !== 'excluded').every((p) => p.status === 'completed');

    setProcessingState((prev) => ({
      ...prev,
      isConverting: false,
      currentPhase: allCompleted ? 'complete' : 'idle',
      completedCount: syncCompletedCount(),
      logMessages: [
        ...prev.logMessages,
        allCompleted
          ? '🎉 অভিনন্দন! বইয়ের সমস্ত পৃষ্ঠা সফলভাবে রূপান্তর সম্পন্ন হয়েছে। ইপাব প্রিভিউ ও প্যাকেজিং প্রস্তুত হচ্ছে...'
          : 'রূপান্তর ব্যাচ সম্পন্ন হয়েছে। কোনো পৃষ্ঠায় ত্রুটি থাকলে আপনি সরাসরি "সকল ত্রুটি পুনরায় স্ক্যান করুন" বাটনে ক্লিক করে পুনরায় চেষ্টা করতে পারেন।',
      ],
    }));

    if (allCompleted && !isCancelledRef.current) {
      setTimeout(() => {
        if (!isCancelledRef.current) {
          setIsExportModalOpen(true);
        }
      }, 1000);
    }
  };

  // Pause conversion
  const handlePauseConversion = () => {
    isCancelledRef.current = true;
    setProcessingState((prev) => ({
      ...prev,
      isConverting: false,
      currentPhase: 'idle',
      completedCount: syncCompletedCount(),
      logMessages: [...prev.logMessages, 'ব্যবহারকারী কর্তৃক রূপান্তর বিরতি দেওয়া হয়েছে।'],
    }));
  };

  // Toggle Page Exclude
  const handleToggleExclude = (index: number) => {
    setPages((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const next = [...prev];
      const newStatus = target.status === 'excluded' ? 'pending' : 'excluded';
      next[index] = { ...target, status: newStatus };
      return next;
    });
  };

  // Delete Individual Page
  const handleDeletePage = (index: number) => {
    const target = pages[index];
    if (!target) return;
    setPageToDelete({ index, pageNumber: target.pageNumber });
  };

  const handleConfirmDeletePage = () => {
    if (!pageToDelete) return;
    const { index, pageNumber } = pageToDelete;

    const remainingPages = pages.filter((_, idx) => idx !== index);
    setPages(remainingPages);

    // Adjust selectedPageIndex
    setSelectedPageIndex((prev) => {
      if (prev >= remainingPages.length) {
        return Math.max(0, remainingPages.length - 1);
      }
      return prev;
    });

    // Adjust coverPageIndex
    setCoverPageIndex((prev) => {
      if (prev === index) return 0;
      if (prev > index) return prev - 1;
      return prev;
    });

    // Update completedCount in processingState
    setProcessingState((prev) => ({
      ...prev,
      completedCount: remainingPages.filter((p) => p.status === 'completed').length,
      logMessages: [...prev.logMessages, `পৃষ্ঠা ${pageNumber} সফলভাবে তালিকা থেকে মুছে ফেলা হয়েছে।`],
    }));

    setPageToDelete(null);
  };

  // Edit Markdown
  const handleUpdateMarkdown = (newMarkdown: string) => {
    setPages((prev) => {
      const next = [...prev];
      if (next[selectedPageIndex]) {
        next[selectedPageIndex] = {
          ...next[selectedPageIndex],
          markdown: newMarkdown,
          status: newMarkdown.trim() ? 'completed' : next[selectedPageIndex].status,
        };
      }
      return next;
    });
  };

  // Reset to original OCR
  const handleResetToOcr = () => {
    setPages((prev) => {
      const next = [...prev];
      if (next[selectedPageIndex] && next[selectedPageIndex].originalOcr) {
        next[selectedPageIndex] = {
          ...next[selectedPageIndex],
          markdown: next[selectedPageIndex].originalOcr,
        };
      }
      return next;
    });
  };

  // Toggle whether an individual page is marked as Table of Contents
  const handleToggleTocPage = (pageIndex: number) => {
    setPages((prev) => {
      const next = [...prev];
      if (next[pageIndex]) {
        next[pageIndex] = {
          ...next[pageIndex],
          isTocPage: !next[pageIndex].isTocPage,
        };
      }
      return next;
    });
  };

  // Rescan a single page manually
  const handleRescanPage = async (pageIndex: number = selectedPageIndex) => {
    const targetPage = pages[pageIndex];
    if (!targetPage) return;

    setProcessingState((prev) => ({
      ...prev,
      currentPageNumber: targetPage.pageNumber,
      currentPhase: 'ocr',
      logMessages: [...prev.logMessages, `পৃষ্ঠা ${targetPage.pageNumber} পুনরায় স্ক্যান শুরু হয়েছে...`],
    }));

    setPages((prev) => {
      if (!prev[pageIndex]) return prev;
      const next = [...prev];
      next[pageIndex] = {
        ...prev[pageIndex],
        status: 'processing',
        errorMsg: undefined,
      };
      return next;
    });

    try {
      const result = await performOcrOnPage(targetPage);
      const isToc = isTableOfContentsText(result.markdown);

      setPages((prev) => {
        const existing = prev[pageIndex];
        if (!existing) return prev;
        const next = [...prev];
        next[pageIndex] = {
          ...existing,
          status: 'completed',
          markdown: result.markdown,
          originalOcr: result.rawOcr,
          ocrValidation: result.ocrValidation,
          figures: result.figures,
          hasImages: Boolean(result.figures && result.figures.length > 0),
          isTocPage: Boolean(isToc || existing.isTocPage),
          appliedMode: result.appliedMode,
          errorMsg: undefined,
        };
        return next;
      });

      setTimeout(() => {
        const exactCompleted = syncCompletedCount();
        setProcessingState((prev) => ({
          ...prev,
          currentPhase: 'complete',
          completedCount: exactCompleted,
          logMessages: [...prev.logMessages, `পৃষ্ঠা ${targetPage.pageNumber} সফলভাবে রিস্ক্যান সম্পন্ন হয়েছে।`],
        }));

        const cur = pagesRef.current;
        const allDone =
          cur.length > 0 &&
          cur.filter((p) => p.status !== 'excluded').every((p) => p.status === 'completed');
        if (allDone) {
          setProcessingState((p) => ({
            ...p,
            logMessages: [
              ...p.logMessages,
              '🎉 অভিনন্দন! বইয়ের সমস্ত পৃষ্ঠা সফলভাবে রূপান্তর সম্পন্ন হয়েছে। ইপাব প্রিভিউ ও প্যাকেজিং প্রস্তুত হচ্ছে...',
            ],
          }));
          setTimeout(() => {
            setIsExportModalOpen(true);
          }, 900);
        }
      }, 50);
    } catch (err: any) {
      console.error(`Page ${targetPage.pageNumber} Rescan error:`, err);
      const friendlyErr = formatFriendlyErrorMessage(err?.message);
      setPages((prev) => {
        if (!prev[pageIndex]) return prev;
        const next = [...prev];
        next[pageIndex] = {
          ...prev[pageIndex],
          status: 'error',
          errorMsg: friendlyErr,
        };
        return next;
      });
      setProcessingState((prev) => ({
        ...prev,
        currentPhase: 'idle',
        completedCount: syncCompletedCount(),
        logMessages: [...prev.logMessages, `রিস্ক্যান ত্রুটি: পৃষ্ঠা ${targetPage.pageNumber} (${friendlyErr})`],
      }));
    }
  };

  // Rescan all errored pages in batches with user trigger (Manual batch rescan)
  const handleRescanAllErrors = async () => {
    const errorIndices = pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter(({ page }) => page.status === 'error')
      .map(({ index }) => index);

    if (errorIndices.length === 0) return;

    isCancelledRef.current = false;
    setProcessingState((prev) => ({
      ...prev,
      isConverting: true,
      logMessages: [
        ...prev.logMessages,
        `সবগুলো ত্রুটিপূর্ণ পাতা (${errorIndices.length}টি) একসাথে পুনরায় স্ক্যান শুরু হচ্ছে...`,
      ],
    }));

    const activeKeysCount = Math.max(1, keyPoolStatus.totalKeys);
    const userBatch = conversionSettings.batchSize || 1;
    const batchSize = Math.max(1, Math.min(5, userBatch));

    for (let i = 0; i < errorIndices.length; i += batchSize) {
      if (isCancelledRef.current) break;

      if (i > 0) {
        const interBatchPacing = activeKeysCount >= 4 ? 150 : activeKeysCount >= 2 ? 400 : 1200;
        await new Promise((r) => setTimeout(r, interBatchPacing));
      }

      if (isCancelledRef.current) break;

      const batch = errorIndices.slice(i, i + batchSize);
      const batchPageNums = batch.map((idx) => pages[idx].pageNumber);

      setProcessingState((prev) => ({
        ...prev,
        currentPageNumber: batchPageNums[0],
        currentPhase: 'ocr',
        logMessages: [
          ...prev.logMessages,
          `ত্রুটি রিস্ক্যান ব্যাচ: পৃষ্ঠা ${batchPageNums.join(', ')}...`,
        ],
      }));

      // Mark as processing
      setPages((prev) => {
        const next = [...prev];
        batch.forEach((idx) => {
          if (prev[idx]) {
            next[idx] = { ...prev[idx], status: 'processing', errorMsg: undefined };
          }
        });
        return next;
      });

      await Promise.all(
        batch.map(async (pageIdx) => {
          const page = pages[pageIdx];
          if (!page) return;
          try {
            const result = await performOcrOnPage(page);
            const isToc = isTableOfContentsText(result.markdown);
            setPages((prev) => {
              const existing = prev[pageIdx];
              if (!existing) return prev;
              const next = [...prev];
              next[pageIdx] = {
                ...existing,
                status: 'completed',
                markdown: result.markdown,
                originalOcr: result.rawOcr,
                ocrValidation: result.ocrValidation,
                figures: result.figures,
                hasImages: Boolean(result.figures && result.figures.length > 0),
                isTocPage: Boolean(isToc || existing.isTocPage),
                appliedMode: result.appliedMode,
                errorMsg: undefined,
              };
              return next;
            });
            setProcessingState((prev) => ({
              ...prev,
              completedCount: syncCompletedCount() + 1,
              logMessages: [...prev.logMessages, `পৃষ্ঠা ${page.pageNumber} রিস্ক্যান সফল!`],
            }));
          } catch (err: any) {
            const friendly = formatFriendlyErrorMessage(err?.message);
            setPages((prev) => {
              if (!prev[pageIdx]) return prev;
              const next = [...prev];
              next[pageIdx] = {
                ...prev[pageIdx],
                status: 'error',
                errorMsg: friendly,
              };
              return next;
            });
            setProcessingState((prev) => ({
              ...prev,
              completedCount: syncCompletedCount(),
              logMessages: [...prev.logMessages, `পৃষ্ঠা ${page.pageNumber} রিস্ক্যান ব্যর্থ (${friendly})`],
            }));
          }
        })
      );

      if (i + batchSize < errorIndices.length) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    const cur = pagesRef.current;
    const allCompleted =
      cur.length > 0 &&
      cur.filter((p) => p.status !== 'excluded').every((p) => p.status === 'completed');

    setProcessingState((prev) => ({
      ...prev,
      isConverting: false,
      currentPhase: allCompleted ? 'complete' : 'idle',
      completedCount: syncCompletedCount(),
      logMessages: [
        ...prev.logMessages,
        allCompleted
          ? '🎉 চমৎকার! বইয়ের সমস্ত পৃষ্ঠা সফলভাবে রূপান্তর সম্পন্ন হয়েছে। ইপাব প্রিভিউ তৈরি হচ্ছে...'
          : 'ত্রুটি রিস্ক্যান পর্ব সমাপ্ত হয়েছে।',
      ],
    }));

    if (allCompleted && !isCancelledRef.current) {
      setTimeout(() => {
        setIsExportModalOpen(true);
      }, 900);
    }
  };

  // Jump to currently processing page (Go Live) and activate Live Auto-Follow
  const handleGoLive = () => {
    setIsLiveTracking(true);
    if (processingState.currentPageNumber !== null) {
      const liveIdx = pages.findIndex((p) => p.pageNumber === processingState.currentPageNumber);
      if (liveIdx !== -1) {
        setSelectedPageIndex(liveIdx);
        return;
      }
    }
    // Fallback: jump to currently processing page or first pending page
    const pendingIdx = pages.findIndex((p) => p.status === 'processing' || p.status === 'pending');
    if (pendingIdx !== -1) {
      setSelectedPageIndex(pendingIdx);
    }
  };

  // Toggle Live Auto-Follow on / off
  const handleToggleLiveTracking = () => {
    setIsLiveTracking((prev) => {
      const next = !prev;
      if (next && processingState.currentPageNumber !== null) {
        const liveIdx = pages.findIndex((p) => p.pageNumber === processingState.currentPageNumber);
        if (liveIdx !== -1) {
          setSelectedPageIndex(liveIdx);
        }
      }
      return next;
    });
  };

  // Select page with intelligent auto-follow pause when user manually clicks another page
  const handleSelectPage = (idx: number, fromUserManual: boolean = false) => {
    setSelectedPageIndex(idx);
    if (fromUserManual && processingState.isConverting) {
      const liveIdx = pages.findIndex((p) => p.pageNumber === processingState.currentPageNumber);
      if (idx !== liveIdx) {
        setIsLiveTracking(false);
      } else {
        setIsLiveTracking(true);
      }
    }
  };

  // Apply configuration from modal
  const handleSaveSegments = (
    newDetails: BookDetails,
    newStructure: StructureConfig,
    newWatermark: WatermarkConfig,
    newConversionSettings: ConversionSettings
  ) => {
    setBookDetails(newDetails);
    setStructureConfig(newStructure);
    setWatermarkConfig(newWatermark);
    setConversionSettings(newConversionSettings);

    if (newStructure.excludedPagesList?.length > 0) {
      setPages((prev) =>
        prev.map((p) => {
          if (newStructure.excludedPagesList.includes(p.pageNumber)) {
            return { ...p, status: 'excluded' };
          }
          if (p.status === 'excluded') {
            return { ...p, status: 'pending' };
          }
          return p;
        })
      );
    }
  };

  // Trigger in-app confirmation modal for removing PDF
  const handleRemovePdf = () => {
    setIsConfirmDeleteOpen(true);
  };

  // Perform actual PDF cleanup and return to upload screen
  const handleConfirmDelete = () => {
    isCancelledRef.current = true;
    pdfDocRef.current = null;
    setPages([]);
    setSelectedPageIndex(0);
    setCoverPageIndex(0);
    setCustomCoverBase64(null);
    setBookDetails({
      title: '',
      author: '',
      publisher: '',
      genre: 'উপন্যাস',
      publishYear: '',
      description: '',
    });
    setCurrentStep(1);
    setProcessingState({
      isConverting: false,
      currentPageNumber: null,
      currentPhase: 'idle',
      completedCount: 0,
      totalCount: 0,
      logMessages: [],
    });
    setIsConfirmDeleteOpen(false);
  };

  // Replace current PDF with another file directly
  const handleReplacePdf = (file: File) => {
    isCancelledRef.current = true;
    handleFileSelected(file);
  };

  // Reset application
  const handleReset = () => {
    handleRemovePdf();
  };

  const hasDocument = pages.length > 0;
  const canExport = pages.some((p) => p.status === 'completed');
  const activePage = pages[selectedPageIndex] || null;

  return (
    <div className={`h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden flex flex-col ${theme === 'dark' ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans transition-colors duration-200 select-none`}>
      {/* Header with Modern Minimal Design & Theme Toggle */}
      <Header
        currentStep={hasDocument ? 4 : 1}
        onReset={handleReset}
        onRemovePdf={handleRemovePdf}
        onReplacePdf={handleReplacePdf}
        onOpenConfig={() => setIsConfigModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
        onResetLayout={handleResetLayout}
        onOpenKeyPool={() => setIsKeyPoolModalOpen(true)}
        keyCount={keyPoolStatus.totalKeys}
        rpmCapacity={keyPoolStatus.rpmCapacity}
        hasDocument={hasDocument}
        canExport={canExport}
        bookTitle={bookDetails.title}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        totalPages={pages.length}
        completedCount={processingState.completedCount}
        isConverting={processingState.isConverting}
        elapsedSeconds={elapsedSeconds}
      />

      {/* Main Container */}
      <main className="flex-1 min-h-0 w-full overflow-hidden flex flex-col relative">
        {!hasDocument ? (
          <div className="flex-1 min-h-0 w-full overflow-y-auto">
            <FileUploadStep
              onFileSelected={handleFileSelected}
              onLoadSampleBook={handleLoadSampleBook}
              isLoading={isLoadingPdf}
              loadingMessage={loadingMessage}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 h-full w-full flex flex-col overflow-hidden relative">
            {pages.length >= 30 && keyPoolStatus.totalKeys === 1 && (
              <div className="bg-indigo-50/95 dark:bg-indigo-950/80 border-b border-indigo-200 dark:border-indigo-800/80 px-2.5 sm:px-4 py-1.5 flex items-center justify-between text-[11px] sm:text-xs text-indigo-950 dark:text-indigo-200 flex-shrink-0 z-20">
                <div className="flex items-center gap-1.5 sm:gap-2 overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse flex-shrink-0" />
                  <span className="truncate">
                    💡 <strong>বড় বই ({pages.length} পাতা):</strong> ১৫ পাতা/মিনিট লিমিট দ্রুত করতে ফ্রি কী যোগ করুন।
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsKeyPoolModalOpen(true)}
                  className="font-bold underline text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 cursor-pointer ml-2 flex-shrink-0 whitespace-nowrap text-[11px] sm:text-xs"
                >
                  কী পুল →
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 h-full w-full flex flex-col lg:flex-row overflow-hidden relative">
              {/* Left Panel: All Pages Thumbnails (Resizable on desktop, full on mobile when selected) */}
              <div className={`${mobileWorkspaceTab === 'pages' ? 'flex' : 'hidden'} lg:flex h-full flex-shrink-0 min-w-0 w-full lg:w-auto`}>
                <PageListSidebar
                  pages={pages}
                  selectedPageIndex={selectedPageIndex}
                  onSelectPage={(idx) => {
                    handleSelectPage(idx, true);
                    setMobileWorkspaceTab('preview');
                  }}
                  onToggleExclude={handleToggleExclude}
                  onToggleTocPage={handleToggleTocPage}
                  onDeletePage={handleDeletePage}
                  isConverting={processingState.isConverting}
                  onRemovePdf={handleRemovePdf}
                  onReplacePdf={handleReplacePdf}
                  onRescanPage={handleRescanPage}
                  bookTitle={bookDetails.title}
                  width={leftWidth}
                  isLiveTracking={isLiveTracking}
                />
              </div>

              {/* Draggable Divider 1: Left / Center (Desktop only) */}
              <div
                onMouseDown={() => setIsDraggingLeft(true)}
                className={`hidden lg:flex w-1.5 hover:w-2 bg-slate-200 dark:bg-slate-800 hover:bg-indigo-400 active:bg-indigo-600 transition-all cursor-col-resize flex-shrink-0 z-30 select-none group relative items-center justify-center ${
                  isDraggingLeft ? 'bg-indigo-600 w-2' : ''
                }`}
                title="টেনে বাম পাশের প্যানেল রিসাইজ করুন"
              >
                <div className="w-0.5 h-6 bg-slate-400 group-hover:bg-white rounded-full pointer-events-none" />
                <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
              </div>

              {/* Center Panel: Full Height Visual PDF Preview */}
              <div className={`${mobileWorkspaceTab === 'preview' ? 'flex' : 'hidden'} lg:flex flex-1 min-w-0 w-full h-full overflow-hidden`}>
                <CenterProcessPanel
                  pages={pages}
                  currentPage={activePage}
                  currentPageIndex={selectedPageIndex}
                  totalPages={pages.length}
                  processingState={processingState}
                  conversionSettings={conversionSettings}
                  errorCount={pages.filter((p) => p.status === 'error').length}
                  onSelectPage={(idx) => handleSelectPage(idx, true)}
                  onStartConversion={handleStartConversion}
                  onPauseConversion={handlePauseConversion}
                  onProcessSinglePage={handleProcessSinglePage}
                  onRescanPage={handleRescanPage}
                  onRescanErrors={handleRescanAllErrors}
                  onGoLive={handleGoLive}
                  onPrevPage={() => handleSelectPage(Math.max(0, selectedPageIndex - 1), true)}
                  onNextPage={() => handleSelectPage(Math.min(pages.length - 1, selectedPageIndex + 1), true)}
                  onChangeBatchSize={(newSize) =>
                    setConversionSettings((prev) => ({ ...prev, batchSize: newSize }))
                  }
                  onToggleExclude={handleToggleExclude}
                  onDeletePage={handleDeletePage}
                  onChangeMode={(newMode) =>
                    setConversionSettings((prev) => ({ ...prev, mode: newMode }))
                  }
                  elapsedSeconds={elapsedSeconds}
                  isLiveTracking={isLiveTracking}
                  onToggleLiveTracking={handleToggleLiveTracking}
                />
              </div>

              {/* Draggable Divider 2: Center / Right (Desktop only) */}
              <div
                onMouseDown={() => setIsDraggingRight(true)}
                className={`hidden lg:flex w-1.5 hover:w-2 bg-slate-200 dark:bg-slate-800 hover:bg-indigo-400 active:bg-indigo-600 transition-all cursor-col-resize flex-shrink-0 z-30 select-none group relative items-center justify-center ${
                  isDraggingRight ? 'bg-indigo-600 w-2' : ''
                }`}
                title="টেনে ডান পাশের এডিটর ও মনিটর প্যানেল রিসাইজ করুন"
              >
                <div className="w-0.5 h-6 bg-slate-400 group-hover:bg-white rounded-full pointer-events-none" />
                <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
              </div>

              {/* Right Panel: Markdown Editor + Relocated Live Process Monitor (Resizable) */}
              <div className={`${mobileWorkspaceTab === 'editor' ? 'flex' : 'hidden'} lg:flex h-full flex-shrink-0 min-w-0 w-full lg:w-auto`}>
                <RightEditorPanel
                  currentPage={activePage}
                  currentPageIndex={selectedPageIndex}
                  pages={pages}
                  totalPages={pages.length}
                  processingState={processingState}
                  conversionSettings={conversionSettings}
                  errorCount={pages.filter((p) => p.status === 'error').length}
                  onUpdateMarkdown={handleUpdateMarkdown}
                  onResetToOcr={handleResetToOcr}
                  onRescanPage={handleRescanPage}
                  onRescanErrors={handleRescanAllErrors}
                  onStartConversion={handleStartConversion}
                  onPauseConversion={handlePauseConversion}
                  onGoLive={handleGoLive}
                  onChangeBatchSize={(newSize) =>
                    setConversionSettings((prev) => ({ ...prev, batchSize: newSize }))
                  }
                  onToggleExclude={handleToggleExclude}
                  onChangeMode={(newMode) =>
                    setConversionSettings((prev) => ({ ...prev, mode: newMode }))
                  }
                  onSelectPage={(idx) => handleSelectPage(idx, true)}
                  width={rightWidth}
                  elapsedSeconds={elapsedSeconds}
                  isLiveTracking={isLiveTracking}
                  onToggleLiveTracking={handleToggleLiveTracking}
                />
              </div>
            </div>

            {/* Mobile & Tablet Bottom View Switcher (Hidden on lg+ desktop) */}
            <nav className="lg:hidden flex-shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe z-30">
              <div className="grid grid-cols-3 h-14 items-center">
                <button
                  type="button"
                  onClick={() => setMobileWorkspaceTab('pages')}
                  className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
                    mobileWorkspaceTab === 'pages'
                      ? 'text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/50 dark:bg-indigo-950/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Files className="w-4 h-4 mb-0.5" />
                  <span className="text-[11px] leading-tight">পাতা ({pages.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileWorkspaceTab('preview')}
                  className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative ${
                    mobileWorkspaceTab === 'preview'
                      ? 'text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/50 dark:bg-indigo-950/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Eye className="w-4 h-4 mb-0.5" />
                  <span className="text-[11px] leading-tight">পিডিএফ ভিউ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileWorkspaceTab('editor')}
                  className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative ${
                    mobileWorkspaceTab === 'editor'
                      ? 'text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/50 dark:bg-indigo-950/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="relative">
                    <Edit3 className="w-4 h-4 mb-0.5" />
                    {processingState.isConverting && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                    )}
                    {pages.filter((p) => p.status === 'error').length > 0 && (
                      <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-rose-500" />
                    )}
                  </div>
                  <span className="text-[11px] leading-tight">এডিটর ও মনিটর</span>
                </button>
              </div>
            </nav>
          </div>
        )}
      </main>

      {/* Upfront Configuration Modal */}
      <PromptSegmentsModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onSave={handleSaveSegments}
        initialBookDetails={bookDetails}
        initialStructureConfig={structureConfig}
        initialWatermarkConfig={watermarkConfig}
        initialConversionSettings={conversionSettings}
        totalPages={pages.length}
      />

      {/* AI Model & Mode Settings Modal */}
      <ModelSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={conversionSettings}
        onSave={(newSettings) => setConversionSettings(newSettings)}
      />

      {/* Final EPUB Export & Reader Modal */}
      <FinalExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        initialBookDetails={bookDetails}
        pages={pages}
        coverPageIndex={coverPageIndex}
        onSelectCoverPage={setCoverPageIndex}
        customCoverBase64={customCoverBase64}
        onSetCustomCover={setCustomCoverBase64}
        structureConfig={structureConfig}
        pdfOutline={pdfOutline}
      />

      {/* Multi-Account Gemini API Key Pool Modal */}
      <KeyPoolModal
        isOpen={isKeyPoolModalOpen}
        onClose={() => setIsKeyPoolModalOpen(false)}
        onKeysUpdated={fetchKeyPoolStatus}
      />

      {/* In-app Confirmation Modal for Deleting PDF (Never blocked in iframe) */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-4 sm:p-6 text-slate-800 dark:text-slate-100 transition-colors">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">পিডিএফ ফাইল মুছে ফেলতে চান?</h3>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">বর্তমান বই ও পৃষ্ঠাগুলোর ডেটা খালি হবে</p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5 sm:mb-6">
              আপনি কি বর্তমান বইটি মুছে ফেলে আপলোড স্ক্রিনে ফিরে যেতে চান? মুছে ফেলার পর আপনি নতুন যেকোনো পিডিএফ ফাইল বেছে নিতে পারবেন।
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmDeleteOpen(false)}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-200 dark:shadow-rose-950 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>হ্যাঁ, মুছে ফেলুন</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-app Confirmation Modal for Deleting an Individual Page */}
      {pageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-sm p-4 sm:p-5 text-slate-800 dark:text-slate-100 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                  পৃষ্ঠা {pageToDelete.pageNumber} মুছে ফেলতে চান?
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  এই পৃষ্ঠাটি বই এবং তালিকা থেকে বাদ দেওয়া হবে
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
              আপনি কি নিশ্চিত যে পৃষ্ঠা {pageToDelete.pageNumber} তালিকা থেকে মুছে ফেলতে চান? এই পাতাটি ওসিআর ব্যাচ ও চূড়ান্ত ইপাবে যুক্ত হবে না।
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPageToDelete(null)}
                className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePage}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-200 dark:shadow-rose-950 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>হ্যাঁ, পৃষ্ঠাটি মুছুন</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
