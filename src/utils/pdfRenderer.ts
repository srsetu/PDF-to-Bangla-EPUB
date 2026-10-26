import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  try {
    // Attempt CDN worker matching pdfjs version for bulletproof loading
    const workerVersion = pdfjsLib.version || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${workerVersion}/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn('PDF.js worker setup fallback:', e);
  }
}

import { PdfOutlineItem, PdfTextBlock } from '../types';
import { reconstructMultiColumnFromGeometry } from './epubLayoutPipeline';

export interface LoadedPdfDoc {
  doc: any;
  numPages: number;
  fingerprint: string;
  outline?: PdfOutlineItem[];
}

/**
 * Extracts text items and 2D layout bounding-box coordinates from a PDF.js page
 * when an embedded text layer exists.
 */
export async function extractPdfPageLayoutBlocks(
  page: any,
  viewport: any
): Promise<{ layoutBlocks: PdfTextBlock[]; columnCount: 1 | 2 | 3 }> {
  try {
    if (!page || typeof page.getTextContent !== 'function') {
      return { layoutBlocks: [], columnCount: 1 };
    }
    const textContent = await page.getTextContent();
    if (!textContent || !Array.isArray(textContent.items) || textContent.items.length === 0) {
      return { layoutBlocks: [], columnCount: 1 };
    }

    const pageWidth = viewport?.width || 600;
    const pageHeight = viewport?.height || 800;
    const rawItems: PdfTextBlock[] = [];

    for (const item of textContent.items) {
      const str = typeof item.str === 'string' ? item.str : '';
      if (!str.trim()) continue;
      const transform = Array.isArray(item.transform) ? item.transform : [12, 0, 0, 12, 0, 0];
      // Convert PDF user space (bottom-left origin) to viewport top-left origin
      let x = Number(transform[4]) || 0;
      let y = pageHeight - (Number(transform[5]) || 0);
      if (viewport && typeof viewport.convertToViewportPoint === 'function') {
        const pt = viewport.convertToViewportPoint(Number(transform[4]) || 0, Number(transform[5]) || 0);
        if (Array.isArray(pt) && pt.length >= 2) {
          x = pt[0];
          y = pt[1];
        }
      }
      const fontSize = Math.max(8, Math.hypot(Number(transform[0]) || 12, Number(transform[1]) || 0));
      const width = Math.max(fontSize, (Number(item.width) || str.length * fontSize * 0.5) * (viewport?.scale || 1));
      const height = Math.max(fontSize, (Number(item.height) || fontSize) * (viewport?.scale || 1));

      rawItems.push({
        text: str,
        x: Math.max(0, x),
        y: Math.max(0, y - height),
        width,
        height,
        fontSize,
        fontName: item.fontName,
      });
    }

    if (rawItems.length === 0) {
      return { layoutBlocks: [], columnCount: 1 };
    }

    // Group horizontally adjacent fragments on the same baseline into logical lines
    rawItems.sort((a, b) => (Math.abs(a.y - b.y) <= 5 ? a.x - b.x : a.y - b.y));
    const mergedLines: PdfTextBlock[] = [];
    for (const item of rawItems) {
      const prev = mergedLines[mergedLines.length - 1];
      if (
        prev &&
        Math.abs(prev.y - item.y) <= Math.max(6, (prev.fontSize || 12) * 0.45) &&
        item.x - (prev.x + prev.width) < pageWidth * 0.06
      ) {
        const gap = item.x - (prev.x + prev.width);
        prev.text = `${prev.text}${gap > (prev.fontSize || 12) * 0.2 ? ' ' : ''}${item.text}`;
        prev.width = Math.max(prev.width, item.x + item.width - prev.x);
        prev.height = Math.max(prev.height, item.height);
      } else {
        mergedLines.push({ ...item });
      }
    }

    const { columnCount } = reconstructMultiColumnFromGeometry(mergedLines, pageWidth, pageHeight);
    return { layoutBlocks: mergedLines, columnCount };
  } catch {
    return { layoutBlocks: [], columnCount: 1 };
  }
}

/**
 * Resolves a destination reference to an absolute page number (1-indexed)
 */
export async function resolvePdfDestToPageNumber(pdfDoc: any, dest: any): Promise<number | undefined> {
  try {
    if (!dest) return undefined;
    let explicitDest = dest;
    if (typeof dest === 'string') {
      explicitDest = await pdfDoc.getDestination(dest);
    }
    if (Array.isArray(explicitDest) && explicitDest[0]) {
      const pageIndex = await pdfDoc.getPageIndex(explicitDest[0]);
      if (typeof pageIndex === 'number' && pageIndex >= 0) {
        return pageIndex + 1; // 1-indexed
      }
    }
  } catch {
    // resolution failed, return undefined
  }
  return undefined;
}

/**
 * Recursively resolves an outline node and its sub-items
 */
async function resolveOutlineItem(pdfDoc: any, item: any): Promise<PdfOutlineItem> {
  const pageNum = await resolvePdfDestToPageNumber(pdfDoc, item.dest);
  const children: PdfOutlineItem[] = [];
  if (Array.isArray(item.items) && item.items.length > 0) {
    for (const child of item.items) {
      children.push(await resolveOutlineItem(pdfDoc, child));
    }
  }
  return {
    title: item.title || '',
    dest: item.dest,
    pageNumber: pageNum,
    items: children,
  };
}

/**
 * Extracts PDF Outline (Bookmarks/TOC) from PDF document
 */
export async function extractPdfOutline(pdfDoc: any): Promise<PdfOutlineItem[]> {
  try {
    if (!pdfDoc || typeof pdfDoc.getOutline !== 'function') return [];
    const outline = await pdfDoc.getOutline();
    if (!Array.isArray(outline) || outline.length === 0) return [];

    const results: PdfOutlineItem[] = [];
    for (const item of outline) {
      results.push(await resolveOutlineItem(pdfDoc, item));
    }
    return results;
  } catch (err) {
    console.warn('PDF outline extraction error:', err);
    return [];
  }
}

/**
 * Loads a PDF from ArrayBuffer or File
 */
export async function loadPdfDocument(fileOrBuffer: File | ArrayBuffer): Promise<LoadedPdfDoc> {
  let arrayBuffer: ArrayBuffer;
  if (fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
  } else {
    arrayBuffer = fileOrBuffer;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true,
  });

  const pdfDoc = await loadingTask.promise;
  const outline = await extractPdfOutline(pdfDoc);

  return {
    doc: pdfDoc,
    numPages: pdfDoc.numPages,
    fingerprint: pdfDoc.fingerprints?.[0] || 'doc_' + Date.now(),
    outline,
  };
}

/**
 * Detects whether a PDF page contains any raster images (illustrations, photos, diagrams)
 */
export async function detectPageHasImages(page: any): Promise<boolean> {
  try {
    const ops = await page.getOperatorList();
    if (!ops || !ops.fnArray || !Array.isArray(ops.fnArray)) {
      return false;
    }

    const OPS = (pdfjsLib as any).OPS || {};
    const imageOpCodes = new Set([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
      OPS.paintJpegXObject,
      85, 86, 84, // Common fallback opcodes in pdf.js
    ].filter((op) => typeof op === 'number'));

    let imageCount = 0;
    for (const fn of ops.fnArray) {
      if (imageOpCodes.has(fn)) {
        imageCount++;
      }
    }
    // In scanned PDF books, every page has 1 full-page scanned background sheet.
    // Only pages with multiple image objects or figures contain embedded illustrations.
    return imageCount > 1;
  } catch (err) {
    console.warn('Image detection fallback:', err);
    return false;
  }
}

/**
 * Renders a specific page to a Canvas and returns a Data URL (JPEG for OCR speed)
 * also returns whether images were detected on the page
 */
export async function renderPageToDataUrl(
  pdfDoc: any,
  pageNumber: number,
  scale: number = 1.5,
  quality: number = 0.88,
  shouldDetectImages: boolean = false
): Promise<{ dataUrl: string; width: number; height: number; hasImages?: boolean }> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  let hasImages: boolean | undefined = undefined;
  if (shouldDetectImages) {
    hasImages = await detectPageHasImages(page);
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  if (!context) {
    throw new Error('Could not get 2D canvas context');
  }

  // Draw white background for clean OCR
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    hasImages,
  };
}

/**
 * Ultra-fast single-pass renderer: renders page once, detects images, extracts layout coordinates,
 * and creates thumbnail in memory via instant canvas scaling without re-parsing PDF.
 */
export async function renderPageAndThumbnail(
  pdfDoc: any,
  pageNumber: number,
  scale: number = 1.35,
  quality: number = 0.85
): Promise<{
  fullDataUrl: string;
  thumbDataUrl: string;
  width: number;
  height: number;
  hasImages: boolean;
  layoutBlocks: PdfTextBlock[];
  columnCount: 1 | 2 | 3;
}> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const [hasImages, layoutInfo] = await Promise.all([
    detectPageHasImages(page),
    extractPdfPageLayoutBlocks(page, viewport),
  ]);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  if (!context) {
    throw new Error('Could not get 2D canvas context');
  }

  // Pure white background for high OCR contrast
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
  const fullDataUrl = canvas.toDataURL('image/jpeg', quality);

  // Generate thumbnail in memory (scaled to 180px width) in <2ms
  const thumbCanvas = document.createElement('canvas');
  const thumbWidth = 180;
  const thumbScale = thumbWidth / canvas.width;
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = Math.max(100, Math.round(canvas.height * thumbScale));

  const thumbCtx = thumbCanvas.getContext('2d');
  if (thumbCtx) {
    thumbCtx.fillStyle = '#FFFFFF';
    thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  }
  const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.65);

  return {
    fullDataUrl,
    thumbDataUrl,
    width: canvas.width,
    height: canvas.height,
    hasImages,
    layoutBlocks: layoutInfo.layoutBlocks,
    columnCount: layoutInfo.columnCount,
  };
}

export {
  cropFigureWithPrecision,
  extractStrictPageImages,
  locateImagesInOperatorList,
  convertPdfImageObjToDataUrl,
} from './imageExtractor';

import { cropFigureWithPrecision } from './imageExtractor';

/**
 * Precision regional figure cropping.
 * Preserves 100% original resolution without downscaling to 480px and without lossy compression.
 */
export async function cropFigureFromPage(
  pageDataUrl: string,
  topPercent: number = 20,
  leftPercent: number = 10,
  widthPercent: number = 80,
  heightPercent: number = 30,
  figureType?: string
): Promise<string> {
  const result = await cropFigureWithPrecision(
    pageDataUrl,
    topPercent,
    leftPercent,
    widthPercent,
    heightPercent,
    figureType
  );
  return result.dataUrl;
}


