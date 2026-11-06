import type { Sheet } from '../cad2d/sheet.ts';
import { sheetToSvg } from './svg.ts';

export function toPng(sheet: Sheet, logoHref: string | null, pxPerMm = 5): Promise<Blob> {
  const svg = sheetToSvg(sheet, { logoHref });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(sheet.w * pxPerMm); c.height = Math.round(sheet.h * pxPerMm);
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return rej(new Error('Canvas not available.')); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed.'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not render drawing to image.')); };
    img.src = url;
  });
}
