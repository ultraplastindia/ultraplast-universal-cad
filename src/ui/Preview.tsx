import { useMemo } from 'react';
import type { Family } from '../core/family.ts';
import { bbox } from '../cad2d/sheet.ts';

export function Preview({ family }: { family: Family }) {
  const svg = useMemo(() => {
    const c = family.calculate(family.defaults);
    if (!c.ok) return '';
    const v = family.views(c.derived)[0];
    type Shape = Extract<(typeof v.ents)[number], { t: 'line' | 'circle' | 'poly' }>;
    const ents = v.ents.filter((e): e is Shape => (e.t === 'line' || e.t === 'circle' || e.t === 'poly') && (e.layer === 'outline' || e.layer === 'centre'));
    const [x0, y0, x1, y1] = bbox(v.ents.filter((e) => e.t !== 'dim' && e.t !== 'text'));
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    const body = ents.map((e) => {
      const st = `fill="none" stroke="${e.layer === 'centre' ? '#c44' : '#223'}" stroke-width="1.3" vector-effect="non-scaling-stroke"`;
      if (e.t === 'line') return `<line x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" ${st}/>`;
      if (e.t === 'circle') return `<circle cx="${e.c[0]}" cy="${e.c[1]}" r="${e.r}" ${st}/>`;
      if (e.t === 'poly') return `<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map((p) => p.join(',')).join(' ')}" ${st}/>`;
      return '';
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - pad} ${-(y1 + pad)} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}"><g transform="scale(1,-1)">${body}</g></svg>`;
  }, [family]);
  return <div className="preview" dangerouslySetInnerHTML={{ __html: svg }} />;
}
