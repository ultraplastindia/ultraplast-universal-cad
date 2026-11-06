export interface Material { id: string; density: number; yieldMPa: number | null; E: number | null; color: string; metal: boolean }
/** density in kg/mm^3, E = Young's modulus in GPa (plastics: typical dry values, strongly temperature/moisture dependent). Yield strengths are TYPICAL values for preliminary checks only;
 *  confirm against supplier certificates before any real use. */
export const MATERIALS: Material[] = [
  { id: 'C45 Steel', E: 210, density: 7.85e-6, yieldMPa: 340, color: '#8d96a0', metal: true },
  { id: 'SS 304', E: 193, density: 8.0e-6, yieldMPa: 215, color: '#b9c2cc', metal: true },
  { id: 'Al 6061-T6', E: 69, density: 2.7e-6, yieldMPa: 240, color: '#c4ccd4', metal: true },
  { id: 'Nylon PA6', E: 3, density: 1.14e-6, yieldMPa: null, color: '#e8e2cf', metal: false },
  { id: 'Acetal POM', E: 2.9, density: 1.41e-6, yieldMPa: null, color: '#f1f1ee', metal: false },
  { id: 'UHMW-PE', E: 0.8, density: 0.93e-6, yieldMPa: null, color: '#dfe9f2', metal: false },
  { id: 'Chrome Steel 100Cr6', E: 210, density: 7.81e-6, yieldMPa: null, color: '#9aa3ad', metal: true },
  { id: 'SS 440C', E: 200, density: 7.65e-6, yieldMPa: null, color: '#b3bcc6', metal: true },
  { id: 'S235 Steel', density: 7.85e-6, yieldMPa: 235, E: 210, color: '#7f8a96', metal: true },
  { id: 'Brass CuZn39Pb3', density: 8.4e-6, yieldMPa: 200, E: 100, color: '#c9a23c', metal: true },
];
export const material = (id: string): Material | undefined => MATERIALS.find((m) => m.id === id);
