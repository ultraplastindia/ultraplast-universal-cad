/* Browser-only file readers for the Design Studio: pictures, PDF pages (pdf.js), SVG and DXF text. */
import type { Raster } from '../lib/trace.ts';

export const MAX_UPLOAD = 25 * 1024 * 1024;
export interface Picture { raster: Raster; dataUrl: string; mime: string; base64: string; w: number; h: number }

/** Draws a picture (or canvas) at most `maxSide` pixels and returns its pixels plus a compressed copy for display/storage. */
export function canvasPicture(src: CanvasImageSource, w0: number, h0: number, maxSide: number, quality = 0.85): Picture {
  const k = Math.min(1, maxSide / Math.max(w0, h0)), w = Math.max(8, Math.round(w0 * k)), h = Math.max(8, Math.round(h0 * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser cannot read pictures here.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const raster: Raster = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
  let dataUrl = cv.toDataURL('image/jpeg', quality);
  if (!dataUrl.startsWith('data:image/jpeg')) dataUrl = cv.toDataURL('image/png');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { raster, dataUrl, mime, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), w, h };
}

export async function readPicture(file: File, maxSide = 1600): Promise<Picture> {
  if (file.size > MAX_UPLOAD) throw new Error('The file is larger than 25 MB. Please use a smaller one.');
  if (/tiff?$/i.test(file.name) || file.type === 'image/tiff') {
    try { const bmp = await createImageBitmap(file); const p = canvasPicture(bmp, bmp.width, bmp.height, maxSide); bmp.close(); return p; }
    catch { throw new Error('This browser cannot open TIFF pictures. Save the scan as PNG or JPG (or PDF) and try again.'); }
  }
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture (JPG, PNG, WebP, TIFF), a PDF, an SVG or a DXF file.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened. Try saving it as JPG or PNG.'); });
  const p = canvasPicture(bmp, bmp.width, bmp.height, maxSide); bmp.close();
  return p;
}

/* ---------- PDF ---------- */
import type { PDFDocumentProxy } from 'pdfjs-dist';
type PdfDoc = PDFDocumentProxy;
// The "legacy" build of pdf.js includes the extra code older Chrome / Edge / Safari versions need (office PCs are not always up to date).
type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsReady: Promise<PdfLib> | null = null;
async function pdfjs(): Promise<PdfLib> {
  pdfjsReady ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })().catch((e) => { pdfjsReady = null; throw new Error(`The PDF reader could not be loaded (${e instanceof Error ? e.message : String(e)}).`); });
  return pdfjsReady;
}
export async function openPdf(file: File): Promise<{ doc: PdfDoc; pages: number }> {
  if (file.size > MAX_UPLOAD) throw new Error('The PDF is larger than 25 MB.');
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try { const doc = await lib.getDocument({ data }).promise; return { doc, pages: doc.numPages }; }
  catch (e) { throw new Error(`The PDF could not be opened (${e instanceof Error ? e.message : 'damaged or password protected'}).`); }
}
export interface PdfPage { picture: Picture; items: { str: string; x: number; y: number; h: number }[]; mmPerPx: number; pageMm: [number, number] }
/** Renders one page to a picture and returns its text with positions (in picture pixels). mmPerPx assumes the page is printed at 1:1. */
export async function renderPdfPage(doc: PdfDoc, n: number, maxSide = 2000): Promise<PdfPage> {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxSide / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); if (!ctx) throw new Error('Your browser cannot draw the PDF page.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
  const picture = canvasPicture(cv, cv.width, cv.height, maxSide, 0.9);
  const k = picture.w / cv.width;
  const tc = await page.getTextContent();
  const items: PdfPage['items'] = [];
  for (const it of tc.items as unknown as { str?: string; transform?: number[] }[]) {
    if (!it.str || !it.transform) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]) as [number, number];
    const h = Math.hypot(it.transform[2], it.transform[3]) * scale;
    items.push({ str: it.str, x: x * k, y: (y - h * 0.5) * k, h: h * k });
  }
  const ptToMm = 25.4 / 72;
  return { picture, items, mmPerPx: (ptToMm / scale) / k, pageMm: [vp1.width * ptToMm, vp1.height * ptToMm] };
}
