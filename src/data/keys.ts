export interface KeyRow { over: number; upTo: number; b: number; h: number; t1: number; t2: number }
/** Parallel keys and keyways, DIN 6885-1 / ISO 773 (shaft diameter over..up to and incl.). t1 = shaft depth, t2 = hub depth. */
export const KEYS: KeyRow[] = [
  { over: 6, upTo: 8, b: 2, h: 2, t1: 1.2, t2: 1.0 },
  { over: 8, upTo: 10, b: 3, h: 3, t1: 1.8, t2: 1.4 },
  { over: 10, upTo: 12, b: 4, h: 4, t1: 2.5, t2: 1.8 },
  { over: 12, upTo: 17, b: 5, h: 5, t1: 3.0, t2: 2.3 },
  { over: 17, upTo: 22, b: 6, h: 6, t1: 3.5, t2: 2.8 },
  { over: 22, upTo: 30, b: 8, h: 7, t1: 4.0, t2: 3.3 },
  { over: 30, upTo: 38, b: 10, h: 8, t1: 5.0, t2: 3.3 },
  { over: 38, upTo: 44, b: 12, h: 8, t1: 5.0, t2: 3.3 },
  { over: 44, upTo: 50, b: 14, h: 9, t1: 5.5, t2: 3.8 },
  { over: 50, upTo: 58, b: 16, h: 10, t1: 6.0, t2: 4.3 },
  { over: 58, upTo: 65, b: 18, h: 11, t1: 7.0, t2: 4.4 },
  { over: 65, upTo: 75, b: 20, h: 12, t1: 7.5, t2: 4.9 },
  { over: 75, upTo: 85, b: 22, h: 14, t1: 9.0, t2: 5.4 },
  { over: 85, upTo: 95, b: 25, h: 14, t1: 9.0, t2: 5.4 },
];
export const keyFor = (d: number): KeyRow | null => KEYS.find((k) => d > k.over && d <= k.upTo) ?? null;
