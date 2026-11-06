import { useEffect, useState } from 'react';

export interface Route { path: string[]; query: URLSearchParams }
function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}
export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => { const f = () => setR(parse()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (to: string): void => { window.location.hash = '#/' + to; };
