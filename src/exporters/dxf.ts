import type { Ent, Layer } from '../cad2d/sheet.ts';

const LAYERS: Record<Layer, { color: number; lt: string }> = {
  outline: { color: 7, lt: 'CONTINUOUS' }, hidden: { color: 5, lt: 'HIDDEN' }, centre: { color: 1, lt: 'CENTER' },
  dim: { color: 3, lt: 'CONTINUOUS' }, text: { color: 7, lt: 'CONTINUOUS' }, hatch: { color: 8, lt: 'CONTINUOUS' }, border: { color: 7, lt: 'CONTINUOUS' },
};
const n = (v: number) => v.toFixed(4);
const esc = (s: string) => s.replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p').replace(/[^\x20-\x7E%]/g, '?');

/** AutoCAD R12 (AC1009) ASCII DXF with LTYPE/LAYER tables. Units: mm, sheet coordinates (A3, origin bottom-left). */
export function toDxf(ents: Ent[]): string {
  const o: (string | number)[] = [];
  const g = (code: number, v: string | number) => o.push(String(code).padStart(3, ' '), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center ____ _ ____ _'); g(72, 65); g(73, 4); g(40, '2.0'); g(49, '1.25'); g(49, '-0.25'); g(49, '0.25'); g(49, '-0.25');
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, 'Hidden __ __ __'); g(72, 65); g(73, 2); g(40, '6.0'); g(49, '3.0'); g(49, '-3.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  for (const [k, v] of Object.entries(LAYERS)) { g(0, 'LAYER'); g(2, k.toUpperCase()); g(70, 0); g(62, v.color); g(6, v.lt); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of ents) {
    const L = e.layer.toUpperCase();
    if (e.t === 'line') { g(0, 'LINE'); g(8, L); g(10, n(e.a[0])); g(20, n(e.a[1])); g(30, '0.0'); g(11, n(e.b[0])); g(21, n(e.b[1])); g(31, '0.0'); }
    else if (e.t === 'circle') { g(0, 'CIRCLE'); g(8, L); g(10, n(e.c[0])); g(20, n(e.c[1])); g(30, '0.0'); g(40, n(e.r)); }
    else if (e.t === 'poly') {
      g(0, 'POLYLINE'); g(8, L); g(66, 1); g(70, e.closed ? 1 : 0);
      for (const p of e.pts) { g(0, 'VERTEX'); g(8, L); g(10, n(p[0])); g(20, n(p[1])); g(30, '0.0'); }
      g(0, 'SEQEND'); g(8, L);
    } else {
      g(0, 'TEXT'); g(8, L); g(10, n(e.p[0])); g(20, n(e.p[1])); g(30, '0.0'); g(40, n(e.h)); g(1, esc(e.s)); if (e.rot) g(50, n(e.rot));
      if (e.anchor === 'c' || e.anchor === 'r') { g(72, e.anchor === 'c' ? 1 : 2); g(11, n(e.p[0])); g(21, n(e.p[1])); g(31, '0.0'); g(73, 0); }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\n') + '\n';
}
