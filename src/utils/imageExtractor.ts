/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PageFigure } from '../types';

/**
 * PDF Transformation Matrix: [a, b, c, d, e, f]
 * [ [a, b, 0],
 *   [c, d, 0],
 *   [e, f, 1] ]
 */
export type Matrix2D = [number, number, number, number, number, number];

export interface ExtractedPdfImageGeometry {
  objId?: string;
  isInline: boolean;
  inlineData?: any;
  // Canvas viewport coordinates (pixels)
  vx: number;
  vy: number;
  vwidth: number;
  vheight: number;
  // Normalized percentage coordinates (0 - 100)
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
  // Raw image dimensions if known
  rawWidth?: number;
  rawHeight?: number;
  // Classification
  isFullPageBackground: boolean;
  isDecorativeOrMicro: boolean;
  align: 'left' | 'center' | 'right';
}

export interface ExtractedImageResult {
  objId?: string;
  dataUrl: string;
  width: number;
  height: number;
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
  align: 'left' | 'center' | 'right';
  mimeType: string;
  isDirectEmbedded: boolean;
  isFullPageBackground: boolean;
}

/**
 * Standard 2D Affine Matrix multiplication: CTM_new = CTM_prev * T
 */
export function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Transforms a point (x, y) by matrix
 */
export function applyMatrixToPoint(m: Matrix2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Computes bounding box of the unit square [0,0] -> [1,1] in viewport coordinates
 */
export function computeImageBoundingBox(
  ctm: Matrix2D,
  viewport: any
): {
  vx: number;
  vy: number;
  vwidth: number;
  vheight: number;
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
} {
  // In PDF, an image is painted into unit square [0,0] -> [1,1]
  const c0 = applyMatrixToPoint(ctm, 0, 0);
  const c1 = applyMatrixToPoint(ctm, 1, 0);
  const c2 = applyMatrixToPoint(ctm, 1, 1);
  const c3 = applyMatrixToPoint(ctm, 0, 1);

  // Convert points through PDF.js viewport to account for page rotation, viewBox, and scaling
  let vp0: [number, number];
  let vp1: [number, number];
  let vp2: [number, number];
  let vp3: [number, number];

  if (viewport && typeof viewport.convertToViewportPoint === 'function') {
    vp0 = viewport.convertToViewportPoint(c0[0], c0[1]);
    vp1 = viewport.convertToViewportPoint(c1[0], c1[1]);
    vp2 = viewport.convertToViewportPoint(c2[0], c2[1]);
    vp3 = viewport.convertToViewportPoint(c3[0], c3[1]);
  } else {
    vp0 = c0;
    vp1 = c1;
    vp2 = c2;
    vp3 = c3;
  }

  const minVx = Math.min(vp0[0], vp1[0], vp2[0], vp3[0]);
  const maxVx = Math.max(vp0[0], vp1[0], vp2[0], vp3[0]);
  const minVy = Math.min(vp0[1], vp1[1], vp2[1], vp3[1]);
  const maxVy = Math.max(vp0[1], vp1[1], vp2[1], vp3[1]);

  const vwidth = Math.max(1, maxVx - minVx);
  const vheight = Math.max(1, maxVy - minVy);

  const totalW = viewport?.width || (maxVx > 0 ? maxVx : 1000);
  const totalH = viewport?.height || (maxVy > 0 ? maxVy : 1000);

  const leftPercent = Math.max(0, Math.min(100, (minVx / totalW) * 100));
  const topPercent = Math.max(0, Math.min(100, (minVy / totalH) * 100));
  const widthPercent = Math.max(0.1, Math.min(100 - leftPercent, (vwidth / totalW) * 100));
  const heightPercent = Math.max(0.1, Math.min(100 - topPercent, (vheight / totalH) * 100));

  return {
    vx: Math.round(minVx),
    vy: Math.round(minVy),
    vwidth: Math.round(vwidth),
    vheight: Math.round(vheight),
    leftPercent,
    topPercent,
    widthPercent,
    heightPercent,
  };
}

/**
 * Resolves horizontal alignment (left, center, right) based on position
 */
export function determineHorizontalAlignment(
  leftPercent: number,
  widthPercent: number
): 'left' | 'center' | 'right' {
  if (widthPercent >= 70) return 'center';
  const centerPoint = leftPercent + widthPercent / 2;
  if (centerPoint < 38) return 'left';
  if (centerPoint > 62) return 'right';
  return 'center';
}

/**
 * Scans a PDF page operator list to locate all embedded image drawing operations
 * and compute their exact geometric bounding boxes and object identifiers.
 */
export async function locateImagesInOperatorList(
  page: any,
  scale: number = 1.0
): Promise<ExtractedPdfImageGeometry[]> {
  try {
    const operatorList = await page.getOperatorList();
    if (!operatorList || !operatorList.fnArray || !Array.isArray(operatorList.fnArray)) {
      return [];
    }

    const viewport = page.getViewport({ scale });
    const OPS = (pdfjsLib as any).OPS || {};

    const opSave = OPS.save ?? 10;
    const opRestore = OPS.restore ?? 11;
    const opTransform = OPS.transform ?? 12;

    const opPaintImageXObject = OPS.paintImageXObject ?? 85;
    const opPaintInlineImageXObject = OPS.paintInlineImageXObject ?? 86;
    const opPaintImageMaskXObject = OPS.paintImageMaskXObject ?? 84;
    const opPaintJpegXObject = OPS.paintJpegXObject ?? 82;

    const imageOps = new Set([
      opPaintImageXObject,
      opPaintInlineImageXObject,
      opPaintImageMaskXObject,
      opPaintJpegXObject,
    ]);

    let currentCTM: Matrix2D = [1, 0, 0, 1, 0, 0];
    const ctmStack: Matrix2D[] = [];
    const geometries: ExtractedPdfImageGeometry[] = [];

    const fns = operatorList.fnArray;
    const args = operatorList.argsArray;

    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      const arg = args[i];

      if (fn === opSave) {
        ctmStack.push([...currentCTM]);
      } else if (fn === opRestore) {
        if (ctmStack.length > 0) {
          currentCTM = ctmStack.pop()!;
        }
      } else if (fn === opTransform && Array.isArray(arg) && arg.length >= 6) {
        const t: Matrix2D = [arg[0], arg[1], arg[2], arg[3], arg[4], arg[5]];
        currentCTM = multiplyMatrices(currentCTM, t);
      } else if (imageOps.has(fn)) {
        const isInline = fn === opPaintInlineImageXObject;
        const objId = !isInline && arg && typeof arg[0] === 'string' ? arg[0] : undefined;
        const inlineData = isInline ? arg?.[0] : undefined;

        const bounds = computeImageBoundingBox(currentCTM, viewport);

        // Classification
        const isFullPageBackground =
          bounds.widthPercent >= 85 &&
          bounds.heightPercent >= 85 &&
          bounds.leftPercent <= 8 &&
          bounds.topPercent <= 8;

        const isDecorativeOrMicro =
          bounds.vwidth < 8 ||
          bounds.vheight < 8 ||
          (bounds.widthPercent < 1.5 && bounds.heightPercent < 1.5);

        const align = determineHorizontalAlignment(bounds.leftPercent, bounds.widthPercent);

        geometries.push({
          objId,
          isInline,
          inlineData,
          vx: bounds.vx,
          vy: bounds.vy,
          vwidth: bounds.vwidth,
          vheight: bounds.vheight,
          leftPercent: bounds.leftPercent,
          topPercent: bounds.topPercent,
          widthPercent: bounds.widthPercent,
          heightPercent: bounds.heightPercent,
          rawWidth: inlineData?.width,
          rawHeight: inlineData?.height,
          isFullPageBackground,
          isDecorativeOrMicro,
          align,
        });
      }
    }

    return geometries;
  } catch (err) {
    console.warn('Operator list image inspection error:', err);
    return [];
  }
}

/**
 * Asynchronously retrieves an image object from PDF.js page.objs or commonObjs
 */
export function getPdfObjectAsync(objs: any, objId: string): Promise<any> {
  return new Promise((resolve) => {
    if (!objs) return resolve(null);
    try {
      if (typeof objs.has === 'function' && objs.has(objId)) {
        return resolve(objs.get(objId));
      }
      if (typeof objs.get === 'function') {
        objs.get(objId, (data: any) => resolve(data));
        // Fallback safety timeout if callback is never called
        setTimeout(() => {
          try {
            if (objs.has && objs.has(objId)) resolve(objs.get(objId));
            else resolve(null);
          } catch {
            resolve(null);
          }
        }, 600);
        return;
      }
      resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Converts a raw PDF image object (ImageBitmap, HTMLCanvasElement, or raw pixel buffer)
 * into a lossless PNG Data URL at 100% native resolution without downscaling or compression degradation.
 */
export function convertPdfImageObjToDataUrl(imgObj: any): {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
} | null {
  if (!imgObj || typeof document === 'undefined') return null;

  try {
    // Case 1: ImageBitmap or HTMLImageElement
    if (
      (typeof ImageBitmap !== 'undefined' && imgObj instanceof ImageBitmap) ||
      imgObj.bitmap
    ) {
      const bmp = imgObj.bitmap || imgObj;
      const w = bmp.width;
      const h = bmp.height;
      if (!w || !h) return null;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(bmp, 0, 0);
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: w,
        height: h,
        mimeType: 'image/png',
      };
    }

    // Case 2: HTMLCanvasElement
    if (typeof HTMLCanvasElement !== 'undefined' && imgObj instanceof HTMLCanvasElement) {
      return {
        dataUrl: imgObj.toDataURL('image/png'),
        width: imgObj.width,
        height: imgObj.height,
        mimeType: 'image/png',
      };
    }

    // Case 3: Raw pixel buffer (RGBA, RGB, Grayscale, 1-bit)
    const width = imgObj.width;
    const height = imgObj.height;
    const rawData: Uint8Array | Uint8ClampedArray = imgObj.data;

    if (!width || !height || !rawData) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imgData = ctx.createImageData(width, height);
    const dest = imgData.data;
    const totalPixels = width * height;

    if (rawData.length === totalPixels * 4) {
      // 32-bit RGBA
      dest.set(rawData);
    } else if (rawData.length === totalPixels * 3) {
      // 24-bit RGB -> expand to RGBA
      let s = 0;
      let d = 0;
      for (let p = 0; p < totalPixels; p++) {
        dest[d] = rawData[s];
        dest[d + 1] = rawData[s + 1];
        dest[d + 2] = rawData[s + 2];
        dest[d + 3] = 255;
        s += 3;
        d += 4;
      }
    } else if (rawData.length === totalPixels) {
      // 8-bit Grayscale -> expand to RGBA
      let s = 0;
      let d = 0;
      for (let p = 0; p < totalPixels; p++) {
        const g = rawData[s];
        dest[d] = g;
        dest[d + 1] = g;
        dest[d + 2] = g;
        dest[d + 3] = 255;
        s += 1;
        d += 4;
      }
    } else if (rawData.length * 8 >= totalPixels) {
      // 1-bit monochrome mask (Black & White)
      let d = 0;
      for (let i = 0; i < rawData.length && d < totalPixels * 4; i++) {
        const byte = rawData[i];
        for (let b = 7; b >= 0 && d < totalPixels * 4; b--) {
          const bit = (byte >> b) & 1;
          const val = bit ? 255 : 0;
          dest[d] = val;
          dest[d + 1] = val;
          dest[d + 2] = val;
          dest[d + 3] = 255;
          d += 4;
        }
      }
    } else {
      // Direct clamp fallback
      for (let i = 0; i < Math.min(rawData.length, dest.length); i++) {
        dest[i] = rawData[i];
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
      mimeType: 'image/png',
    };
  } catch (err) {
    console.warn('Error converting PDF image object to dataUrl:', err);
    return null;
  }
}

/**
 * Precision Whitespace Detection:
 * Determines the true ink bounding envelope of an image region to exclude outside page margin whitespace,
 * while strictly preserving whitespace that is inside the illustration.
 */
export function findPreciseContentBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { minX: number; minY: number; maxX: number; maxY: number; hasContent: boolean } {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 1. Sample corner pixels (5x5 patches) to determine the exact background paper tone
  let bgR = 255;
  let bgG = 255;
  let bgB = 255;
  let sampleCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  const sampleCorners = [
    [0, 0],
    [Math.max(0, width - 6), 0],
    [0, Math.max(0, height - 6)],
    [Math.max(0, width - 6), Math.max(0, height - 6)],
  ];

  for (const [startX, startY] of sampleCorners) {
    for (let dy = 0; dy < 5 && startY + dy < height; dy++) {
      for (let dx = 0; dx < 5 && startX + dx < width; dx++) {
        const idx = ((startY + dy) * width + (startX + dx)) * 4;
        sumR += data[idx];
        sumG += data[idx + 1];
        sumB += data[idx + 2];
        sampleCount++;
      }
    }
  }

  if (sampleCount > 0) {
    bgR = sumR / sampleCount;
    bgG = sumG / sampleCount;
    bgB = sumB / sampleCount;
  }

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let contentPixels = 0;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // If pixel is semi-transparent, it's non-background
      if (a < 240) {
        contentPixels++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        continue;
      }

      // Perceptual luminance difference from background paper
      const diff =
        Math.abs(r - bgR) * 0.299 +
        Math.abs(g - bgG) * 0.587 +
        Math.abs(b - bgB) * 0.114;

      if (diff > 18) {
        contentPixels++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }

  const hasContent = contentPixels > 20 && maxX >= minX && maxY >= minY;
  return {
    minX: hasContent ? minX : 0,
    minY: hasContent ? minY : 0,
    maxX: hasContent ? maxX : width - 1,
    maxY: hasContent ? maxY : height - 1,
    hasContent,
  };
}

/**
 * High-Precision Regional Crop:
 * Used when direct embedded extraction is unavailable (e.g. scanned books where illustrations
 * are drawn on paper, or complex vector artwork).
 *
 * PRESERVES 100% ORIGINAL NATIVE RESOLUTION:
 * - NO downscaling to 480px!
 * - NO lossy JPEG re-compression!
 * - Preserves exact aspect ratio and boundary!
 * - Detects true content boundaries without cutting into drawing edges!
 */
export function cropFigureWithPrecision(
  pageDataUrl: string,
  topPercent: number = 20,
  leftPercent: number = 10,
  widthPercent: number = 80,
  heightPercent: number = 30,
  figureType?: string
): Promise<{ dataUrl: string; width: number; height: number; mimeType: string }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      return resolve({
        dataUrl: pageDataUrl,
        width: 800,
        height: 600,
        mimeType: 'image/png',
      });
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const safeLeft = Math.max(0, Math.min(98, leftPercent));
        const safeTop = Math.max(0, Math.min(98, topPercent));
        const safeWidth = Math.max(2, Math.min(100 - safeLeft, widthPercent));
        const safeHeight = Math.max(2, Math.min(100 - safeTop, heightPercent));

        // Exact pixel boundary on source image (preserving full original resolution)
        const rawLeft = Math.round((safeLeft / 100) * img.width);
        const rawTop = Math.round((safeTop / 100) * img.height);
        const rawWidth = Math.max(10, Math.round((safeWidth / 100) * img.width));
        const rawHeight = Math.max(10, Math.round((safeHeight / 100) * img.height));

        const cropW = Math.min(img.width - rawLeft, rawWidth);
        const cropH = Math.min(img.height - rawTop, rawHeight);

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return resolve({
            dataUrl: pageDataUrl,
            width: img.width,
            height: img.height,
            mimeType: 'image/jpeg',
          });
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, cropW, cropH);
        ctx.drawImage(img, rawLeft, rawTop, cropW, cropH, 0, 0, cropW, cropH);

        // Precise boundary refinement: trim only surrounding outside paper margin
        const bounds = findPreciseContentBounds(ctx, cropW, cropH);
        if (bounds.hasContent) {
          const contentW = bounds.maxX - bounds.minX + 1;
          const contentH = bounds.maxY - bounds.minY + 1;

          // Gentle natural margin (minimum 4px or 3%) to prevent edge clipping
          const padX = Math.max(4, Math.round(contentW * 0.03));
          const padY = Math.max(4, Math.round(contentH * 0.03));

          const finalW = contentW + padX * 2;
          const finalH = contentH + padY * 2;

          const trimmedCanvas = document.createElement('canvas');
          trimmedCanvas.width = finalW;
          trimmedCanvas.height = finalH;
          const trimmedCtx = trimmedCanvas.getContext('2d');

          if (trimmedCtx) {
            trimmedCtx.fillStyle = '#FFFFFF';
            trimmedCtx.fillRect(0, 0, finalW, finalH);
            trimmedCtx.drawImage(
              canvas,
              bounds.minX,
              bounds.minY,
              contentW,
              contentH,
              padX,
              padY,
              contentW,
              contentH
            );

            // Export lossless PNG for maximum visual fidelity without downscaling
            return resolve({
              dataUrl: trimmedCanvas.toDataURL('image/png'),
              width: finalW,
              height: finalH,
              mimeType: 'image/png',
            });
          }
        }

        // Return full crop without downscaling
        return resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: cropW,
          height: cropH,
          mimeType: 'image/png',
        });
      } catch (err) {
        return resolve({
          dataUrl: pageDataUrl,
          width: img.width,
          height: img.height,
          mimeType: 'image/jpeg',
        });
      }
    };

    img.onerror = () =>
      resolve({
        dataUrl: pageDataUrl,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
      });

    img.src = pageDataUrl;
  });
}

/**
 * Computes bounding box Intersection over Union (IoU)
 */
export function calculateBoxIoU(
  boxA: { left: number; top: number; width: number; height: number },
  boxB: { left: number; top: number; width: number; height: number }
): number {
  const xA = Math.max(boxA.left, boxB.left);
  const yA = Math.max(boxA.top, boxB.top);
  const xB = Math.min(boxA.left + boxA.width, boxB.left + boxB.width);
  const yB = Math.min(boxA.top + boxA.height, boxB.top + boxB.height);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Master Pipeline: Extracts and matches images for a PDF page with strict fidelity.
 * 1. Checks internal PDF structure and inspects embedded image objects directly.
 * 2. Filters out full-page background scans and micro-spacers.
 * 3. Extracts original embedded image data directly at native resolution.
 * 4. Matches detected OCR figures to direct embedded objects.
 * 5. Falls back to precision regional cropping if no direct object exists.
 */
export async function extractStrictPageImages(
  pdfDoc: any,
  pageNumber: number,
  pageDataUrl: string,
  detectedFigures: Array<{
    caption: string;
    type: string;
    top?: number;
    left?: number;
    width?: number;
    height?: number;
    align?: 'left' | 'center' | 'right';
  }> = []
): Promise<PageFigure[]> {
  const results: PageFigure[] = [];

  // Deduplication cache by object ID across this page
  const directObjCache = new Map<string, { dataUrl: string; width: number; height: number; mimeType: string }>();

  let directGeometries: ExtractedPdfImageGeometry[] = [];
  let pageObj: any = null;

  if (pdfDoc && typeof pdfDoc.getPage === 'function') {
    try {
      pageObj = await pdfDoc.getPage(pageNumber);
      directGeometries = await locateImagesInOperatorList(pageObj, 1.5);
    } catch (err) {
      console.warn('PDF operator inspection error for page', pageNumber, err);
    }
  }

  // Filter out full-page scanned background sheets (e.g. 95% width & height)
  // Genuine embedded images are those that are NOT full-page backgrounds and NOT micro artifacts
  const genuineDirectImages = directGeometries.filter(
    (g) => !g.isFullPageBackground && !g.isDecorativeOrMicro
  );

  // Helper to extract direct image object
  const extractDirectObject = async (
    geom: ExtractedPdfImageGeometry
  ): Promise<{ dataUrl: string; width: number; height: number; mimeType: string } | null> => {
    if (geom.objId && directObjCache.has(geom.objId)) {
      return directObjCache.get(geom.objId)!;
    }

    let imgObj: any = null;
    if (geom.isInline && geom.inlineData) {
      imgObj = geom.inlineData;
    } else if (geom.objId && pageObj?.objs) {
      imgObj = await getPdfObjectAsync(pageObj.objs, geom.objId);
      if (!imgObj && pageObj.commonObjs) {
        imgObj = await getPdfObjectAsync(pageObj.commonObjs, geom.objId);
      }
    }

    if (imgObj) {
      const converted = convertPdfImageObjToDataUrl(imgObj);
      if (converted) {
        if (geom.objId) directObjCache.set(geom.objId, converted);
        return converted;
      }
    }

    return null;
  };

  // If we have detected figures from Gemini OCR:
  if (detectedFigures && detectedFigures.length > 0) {
    for (const fig of detectedFigures) {
      const figTop = fig.top ?? 20;
      const figLeft = fig.left ?? 10;
      const figWidth = fig.width ?? 80;
      const figHeight = fig.height ?? 30;

      const figBox = {
        top: figTop,
        left: figLeft,
        width: figWidth,
        height: figHeight,
      };

      // Check if any genuine direct image overlaps with this figure
      let bestMatchGeom: ExtractedPdfImageGeometry | null = null;
      let highestIoU = 0;

      for (const geom of genuineDirectImages) {
        const geomBox = {
          top: geom.topPercent,
          left: geom.leftPercent,
          width: geom.widthPercent,
          height: geom.heightPercent,
        };
        const iou = calculateBoxIoU(figBox, geomBox);
        if (iou > highestIoU) {
          highestIoU = iou;
          bestMatchGeom = geom;
        }
      }

      // If there is only 1 genuine embedded image and 1 figure, pair them up
      if (!bestMatchGeom && genuineDirectImages.length === 1 && detectedFigures.length === 1) {
        bestMatchGeom = genuineDirectImages[0];
      }

      let extractedData: { dataUrl: string; width: number; height: number; mimeType: string } | null = null;
      let isDirect = false;

      if (bestMatchGeom) {
        extractedData = await extractDirectObject(bestMatchGeom);
        if (extractedData) isDirect = true;
      }

      // Fallback: Precision regional cropping without downscaling or lossy compression
      if (!extractedData) {
        extractedData = await cropFigureWithPrecision(
          pageDataUrl,
          figTop,
          figLeft,
          figWidth,
          figHeight,
          fig.type
        );
      }

      results.push({
        caption: fig.caption || 'চিত্র',
        type: fig.type || 'figure',
        imageUrl: extractedData.dataUrl,
        dataUrl: extractedData.dataUrl,
        top: bestMatchGeom ? bestMatchGeom.topPercent : figTop,
        left: bestMatchGeom ? bestMatchGeom.leftPercent : figLeft,
        width: bestMatchGeom ? bestMatchGeom.widthPercent : figWidth,
        height: bestMatchGeom ? bestMatchGeom.heightPercent : figHeight,
        align: fig.align || (bestMatchGeom ? bestMatchGeom.align : 'center'),
        originalWidth: extractedData.width,
        originalHeight: extractedData.height,
        mimeType: extractedData.mimeType,
        isDirectEmbedded: isDirect,
        objId: bestMatchGeom?.objId,
      });
    }
  } else if (genuineDirectImages.length > 0) {
    // If no figures were explicitly specified by OCR, but genuine embedded illustrations exist:
    for (const geom of genuineDirectImages) {
      const extracted = await extractDirectObject(geom);
      if (extracted) {
        results.push({
          caption: 'চিত্র',
          type: 'illustration',
          imageUrl: extracted.dataUrl,
          dataUrl: extracted.dataUrl,
          top: geom.topPercent,
          left: geom.leftPercent,
          width: geom.widthPercent,
          height: geom.heightPercent,
          align: geom.align,
          originalWidth: extracted.width,
          originalHeight: extracted.height,
          mimeType: extracted.mimeType,
          isDirectEmbedded: true,
          objId: geom.objId,
        });
      }
    }
  }

  return results;
}
