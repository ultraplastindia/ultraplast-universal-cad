import type { Family, Variant } from '../core/family.ts';
import { CATEGORIES, IMPLEMENTED } from '../data/catalogue.ts';

export interface SearchFilters { category?: string; material?: string }
export interface FamilyHit { family: Family; variants: Variant[]; variantCount: number; score: number }
export interface PendingHit { category: string; categoryName: string; item: string }
export interface SearchResult { hits: FamilyHit[]; pending: PendingHit[] }

const tokens = (q: string) => q.toLowerCase().split(/[\s,]+/).filter(Boolean);
const catName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name ?? id;

const familyText = (f: Family) => [f.name, f.description, f.subcategory, catName(f.category), f.category, ...f.keywords, ...f.applications, ...f.materials, ...f.standards].join(' ').toLowerCase();
const variantText = (v: Variant) => `${v.id} ${v.name}`.toLowerCase();

/** Searches the real component master library (families + every variant) and the coverage catalogue. */
export function searchCatalogue(families: Family[], query: string, filters: SearchFilters = {}): SearchResult {
  const t = tokens(query);
  const hits: FamilyHit[] = [];
  for (const f of families) {
    if (filters.category && f.category !== filters.category) continue;
    if (filters.material && !f.materials.includes(filters.material)) continue;
    const ft = familyText(f);
    const matching = f.variants.filter((v) => { const vt = ft + ' ' + variantText(v); return t.every((x) => vt.includes(x)); });
    if (!matching.length) continue;
    const score = t.reduce((a, x) => a + (f.name.toLowerCase().includes(x) ? 3 : 0) + (f.keywords.some((k) => k.includes(x)) ? 2 : 0) + (ft.includes(x) ? 1 : 0), 0);
    // when the query only matches family-level text, show a sample of variants; otherwise only those that match
    const narrowed = t.length && matching.length < f.variants.length ? matching : f.variants;
    hits.push({ family: f, variants: narrowed.slice(0, 8), variantCount: narrowed.length, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const pending: PendingHit[] = [];
  if (!filters.material) for (const c of CATEGORIES) {
    if (filters.category && c.id !== filters.category) continue;
    for (const item of c.items) {
      if (IMPLEMENTED[`${c.id}:${item}`]) continue;
      const text = `${item} ${c.name}`.toLowerCase();
      if (t.every((x) => text.includes(x))) pending.push({ category: c.id, categoryName: c.name, item });
    }
  }
  return { hits, pending };
}

export function suggest(families: Family[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = new Set<string>();
  for (const f of families) if (f.name.toLowerCase().includes(q) || f.keywords.some((k) => k.startsWith(q))) out.add(f.name);
  for (const c of CATEGORIES) { if (c.name.toLowerCase().includes(q)) out.add(c.name); for (const i of c.items) if (i.toLowerCase().includes(q)) out.add(i); }
  for (const f of families) for (const v of f.variants) if (v.id.toLowerCase().includes(q)) { out.add(v.id); if (out.size > 40) break; }
  return [...out].slice(0, limit);
}

const RK = 'ultraplast.recent';
export const getRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RK) ?? '[]'); } catch { return []; } };
export const pushRecent = (id: string): void => { try { localStorage.setItem(RK, JSON.stringify([id, ...getRecent().filter((x) => x !== id)].slice(0, 6))); } catch { /* storage unavailable */ } };
