export interface RollerChain { id: string; std: 'ISO 606' | 'ASME B29.1'; pitch: number; rollerDia: number; innerWidth: number }
/** Standard single-strand roller chain dimensions (pitch p, roller dia d1, inner width b1), mm. */
export const ROLLER_CHAINS: RollerChain[] = [
  { id: '06B-1', std: 'ISO 606', pitch: 9.525, rollerDia: 6.35, innerWidth: 5.72 },
  { id: '08B-1', std: 'ISO 606', pitch: 12.7, rollerDia: 8.51, innerWidth: 7.75 },
  { id: '10B-1', std: 'ISO 606', pitch: 15.875, rollerDia: 10.16, innerWidth: 9.65 },
  { id: '12B-1', std: 'ISO 606', pitch: 19.05, rollerDia: 12.07, innerWidth: 11.68 },
  { id: '16B-1', std: 'ISO 606', pitch: 25.4, rollerDia: 15.88, innerWidth: 17.02 },
  { id: '20B-1', std: 'ISO 606', pitch: 31.75, rollerDia: 19.05, innerWidth: 19.56 },
  { id: '24B-1', std: 'ISO 606', pitch: 38.1, rollerDia: 25.4, innerWidth: 25.22 },
  { id: 'ANSI 40', std: 'ASME B29.1', pitch: 12.7, rollerDia: 7.92, innerWidth: 7.85 },
  { id: 'ANSI 50', std: 'ASME B29.1', pitch: 15.875, rollerDia: 10.16, innerWidth: 9.4 },
  { id: 'ANSI 60', std: 'ASME B29.1', pitch: 19.05, rollerDia: 11.91, innerWidth: 12.57 },
  { id: 'ANSI 80', std: 'ASME B29.1', pitch: 25.4, rollerDia: 15.88, innerWidth: 15.75 },
];
