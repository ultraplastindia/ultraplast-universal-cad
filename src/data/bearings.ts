export interface Bearing { id: string; d: number; D: number; B: number }
/** Deep-groove ball bearing boundary dimensions per ISO 15 (bore d, outside D, width B), mm. */
export const BEARINGS: Bearing[] = [
  { id: '6200', d: 10, D: 30, B: 9 }, { id: '6201', d: 12, D: 32, B: 10 }, { id: '6202', d: 15, D: 35, B: 11 },
  { id: '6203', d: 17, D: 40, B: 12 }, { id: '6204', d: 20, D: 47, B: 14 }, { id: '6205', d: 25, D: 52, B: 15 },
  { id: '6206', d: 30, D: 62, B: 16 }, { id: '6207', d: 35, D: 72, B: 17 }, { id: '6208', d: 40, D: 80, B: 18 },
  { id: '6004', d: 20, D: 42, B: 12 }, { id: '6005', d: 25, D: 47, B: 12 }, { id: '6006', d: 30, D: 55, B: 13 },
  { id: '6305', d: 25, D: 62, B: 17 }, { id: '6306', d: 30, D: 72, B: 19 },
];
