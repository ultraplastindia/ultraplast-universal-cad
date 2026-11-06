import type { Params } from './types.ts';
export const fmt = (n: number, dp = 3): string => (Number.isFinite(n) ? String(+n.toFixed(dp)) : '—');
export const num = (p: Params, k: string): number => {
  const v = p[k];
  return typeof v === 'number' ? v : Number(v);
};
export const deg = (r: number): number => (r * 180) / Math.PI;
export const today = (): string => new Date().toISOString().slice(0, 10);
export const slug = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
