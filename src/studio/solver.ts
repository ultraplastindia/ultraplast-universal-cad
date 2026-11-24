import type { Pt } from '../core/types.ts';
import type { Constraint, Ent, EntOf, LRef, PRef, StudioDoc } from './model.ts';
import { dimRefs, polarPt } from './geom.ts';

/* Geometric constraint solver (damped least squares / Levenberg-Marquardt with a numeric Jacobian).
 * Unknowns: the numbers of every entity that a constraint or a driving dimension touches. Everything else stays exactly where it is.
 * A tiny pull towards the current values keeps under-constrained sketches from jumping. If the constraints cannot all be met,
 * NOTHING is changed and the conflicting ones are listed. */

type Acc = { e: Ent; off: number; n: number };
const nParams = (e: Ent): number => (e.k === 'line' ? 4 : e.k === 'poly' || e.k === 'spline' ? e.pts.length * 2 : e.k === 'circle' ? 3 : e.k === 'arc' || e.k === 'ellipse' ? 5 : e.k === 'text' ? 2 : 0);
function read(e: Ent): number[] {
  switch (e.k) {
    case 'line': return [...e.a, ...e.b];
    case 'poly': case 'spline': return e.pts.flat();
    case 'circle': return [...e.c, e.r];
    case 'arc': return [...e.c, e.r, e.a0, e.a1];
    case 'ellipse': return [...e.c, e.rx, e.ry, e.rot];
    case 'text': return [...e.p];
    default: return [];
  }
}
function write(e: Ent, v: number[]): Ent {
  const P = (i: number): Pt => [v[i], v[i + 1]];
  switch (e.k) {
    case 'line': return { ...e, a: P(0), b: P(2) };
    case 'poly': case 'spline': return { ...e, pts: e.pts.map((_, i) => P(2 * i)) };
    case 'circle': return { ...e, c: P(0), r: Math.abs(v[2]) };
    case 'arc': return { ...e, c: P(0), r: Math.abs(v[2]), a0: v[3], a1: v[4] };
    case 'ellipse': return { ...e, c: P(0), rx: Math.abs(v[2]), ry: Math.abs(v[3]), rot: v[4] };
    case 'text': return { ...e, p: P(0) };
    default: return e;
  }
}

export interface SolveResult { ok: boolean; doc: StudioDoc; error?: string; conflicts: string[]; dof: number; iterations: number; maxError: number }

/** Constraints written in plain words, for the panel and for error messages. */
export function describeConstraint(c: Constraint): string {
  switch (c.t) {
    case 'horizontal': return 'Horizontal'; case 'vertical': return 'Vertical';
    case 'parallel': return 'Parallel'; case 'perpendicular': return 'Perpendicular'; case 'equal': return 'Equal length';
    case 'equalRadius': return 'Equal radius'; case 'concentric': return 'Concentric'; case 'tangent': return 'Tangent';
    case 'coincident': return 'Coincident points'; case 'symmetric': return 'Symmetric'; case 'fix': return 'Fixed';
  }
}

/** entity ids a constraint or driving dimension refers to */
export function refsOf(c: Constraint | EntOf<'dim'>): string[] {
  if ('k' in c) return dimRefs(c.d);
  switch (c.t) {
    case 'horizontal': case 'vertical': return [c.l.e];
    case 'parallel': case 'perpendicular': case 'equal': return [c.l1.e, c.l2.e];
    case 'equalRadius': case 'concentric': return [c.e1, c.e2];
    case 'tangent': return [c.l.e, c.e];
    case 'coincident': return [c.p1.e, c.p2.e];
    case 'symmetric': return [c.p1.e, c.p2.e, c.axis.e];
    case 'fix': return [c.e];
  }
}

export function solve(doc: StudioDoc, opts: { fixed?: string[]; maxIter?: number } = {}): SolveResult {
  const dims = doc.ents.filter((e): e is EntOf<'dim'> => e.k === 'dim' && e.drive !== undefined);
  const rules = doc.constraints.filter((c) => c.t !== 'fix');
  if (!rules.length && !dims.length) return { ok: true, doc, conflicts: [], dof: 0, iterations: 0, maxError: 0 };
  const locked = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));
  const fixed = new Set<string>([...(opts.fixed ?? []), ...doc.constraints.filter((c) => c.t === 'fix').flatMap(refsOf)]);
  for (const e of doc.ents) if (locked.has(e.layer) || e.feature) fixed.add(e.id);
  const byId = new Map(doc.ents.map((e) => [e.id, e]));
  // unknowns
  const acc = new Map<string, Acc>(); let N = 0;
  const involved = new Set([...rules.flatMap(refsOf), ...dims.flatMap(refsOf)]);
  for (const id of involved) { const e = byId.get(id); if (!e) return { ok: false, doc, error: 'A constraint refers to an item that was deleted. Remove that constraint.', conflicts: [], dof: 0, iterations: 0, maxError: Infinity }; if (!fixed.has(id)) { const n = nParams(e); acc.set(id, { e, off: N, n }); N += n; } }
  const x0: number[] = new Array(N);
  for (const a of acc.values()) read(a.e).forEach((v, i) => { x0[a.off + i] = v; });
  const vals = (x: number[], id: string): number[] => { const a = acc.get(id); return a ? x.slice(a.off, a.off + a.n) : read(byId.get(id)!); };
  const ent = (x: number[], id: string): Ent => { const e = byId.get(id)!; const a = acc.get(id); return a ? write(e, x.slice(a.off, a.off + a.n)) : e; };
  const pt = (x: number[], r: PRef): Pt => {
    const e = byId.get(r.e)!, v = vals(x, r.e);
    if (e.k === 'arc') return r.i === 0 ? [v[0], v[1]] : polarPt([v[0], v[1]], v[2], r.i === 1 ? v[3] : v[4]);
    if (e.k === 'line') return r.i === 0 ? [v[0], v[1]] : [v[2], v[3]];
    return [v[2 * r.i] ?? v[0], v[2 * r.i + 1] ?? v[1]];
  };
  const ln = (x: number[], r: LRef): [Pt, Pt] => {
    const e = byId.get(r.e)!, v = vals(x, r.e);
    if (e.k === 'line') return [[v[0], v[1]], [v[2], v[3]]];
    const n = e.k === 'poly' ? e.pts.length : 2, s = r.seg ?? 0, t = (s + 1) % n;
    return [[v[2 * s], v[2 * s + 1]], [v[2 * t], v[2 * t + 1]]];
  };
  const circ = (x: number[], id: string): { c: Pt; r: number } => { const v = vals(x, id); return { c: [v[0], v[1]], r: Math.abs(v[2]) }; };
  // a length scale so angular residuals are comparable to millimetres
  let scale = 1; for (const v of x0) scale = Math.max(scale, Math.abs(v)); scale = Math.min(scale, 1e4);
  const dirOf = (l: [Pt, Pt]): { u: Pt; L: number } => { const dx = l[1][0] - l[0][0], dy = l[1][1] - l[0][1], L = Math.hypot(dx, dy) || 1e-12; return { u: [dx / L, dy / L], L }; };
  // signs of h/v distances are kept as drawn
  const sgn = new Map<string, number>();
  for (const d of dims) if (d.d.kind === 'hdist' || d.d.kind === 'vdist') { const p = pt(x0, d.d.p1), q = pt(x0, d.d.p2); const k = d.d.kind === 'hdist' ? 0 : 1; sgn.set(d.id, Math.sign(q[k] - p[k]) || 1); }

  const labels: string[] = [];
  const residuals = (x: number[], out: number[]): void => {
    out.length = 0; labels.length = 0;
    const R = (v: number, what: string) => { out.push(v); labels.push(what); };
    for (const c of rules) {
      const w = describeConstraint(c);
      switch (c.t) {
        case 'horizontal': { const l = ln(x, c.l); R(l[1][1] - l[0][1], w); break; }
        case 'vertical': { const l = ln(x, c.l); R(l[1][0] - l[0][0], w); break; }
        case 'parallel': case 'perpendicular': {
          const a = dirOf(ln(x, c.l1)), b = dirOf(ln(x, c.l2)), L = (a.L + b.L) / 2;
          R((c.t === 'parallel' ? a.u[0] * b.u[1] - a.u[1] * b.u[0] : a.u[0] * b.u[0] + a.u[1] * b.u[1]) * L, w); break;
        }
        case 'equal': R(dirOf(ln(x, c.l1)).L - dirOf(ln(x, c.l2)).L, w); break;
        case 'equalRadius': R(circ(x, c.e1).r - circ(x, c.e2).r, w); break;
        case 'concentric': { const a = circ(x, c.e1).c, b = circ(x, c.e2).c; R(a[0] - b[0], w); R(a[1] - b[1], w); break; }
        case 'tangent': {
          const l = ln(x, c.l), o = byId.get(c.e)!;
          const { u } = dirOf(l), cc = o.k === 'line' ? null : circ(x, c.e);
          if (cc) { const dd = Math.abs((cc.c[0] - l[0][0]) * u[1] - (cc.c[1] - l[0][1]) * u[0]); R(dd - cc.r, w); }
          break;
        }
        case 'coincident': { const p = pt(x, c.p1), q = pt(x, c.p2); R(p[0] - q[0], w); R(p[1] - q[1], w); break; }
        case 'symmetric': {
          const p = pt(x, c.p1), q = pt(x, c.p2), a = ln(x, c.axis), { u } = dirOf(a), m: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          R((m[0] - a[0][0]) * u[1] - (m[1] - a[0][1]) * u[0], w); R((q[0] - p[0]) * u[0] + (q[1] - p[1]) * u[1], w); break;
        }
      }
    }
    for (const d of dims) {
      const v = d.drive!, k = d.d, w = 'Dimension';
      if (k.kind === 'dist') { const p = pt(x, k.p1), q = pt(x, k.p2); R(Math.hypot(q[0] - p[0], q[1] - p[1]) - v, w); }
      else if (k.kind === 'hdist' || k.kind === 'vdist') { const p = pt(x, k.p1), q = pt(x, k.p2), i = k.kind === 'hdist' ? 0 : 1; R((q[i] - p[i]) - (sgn.get(d.id) ?? 1) * v, w); }
      else if (k.kind === 'length') R(dirOf(ln(x, k.l)).L - v, w);
      else if (k.kind === 'radius') R(circ(x, k.e).r - v, w);
      else if (k.kind === 'diameter') R(2 * circ(x, k.e).r - v, w);
      else if (k.kind === 'angle') { const a = dirOf(ln(x, k.l1)), b = dirOf(ln(x, k.l2)); const ang = Math.acos(Math.max(-1, Math.min(1, a.u[0] * b.u[0] + a.u[1] * b.u[1]))); R((ang - (v * Math.PI) / 180) * scale * 0.1, w); }
    }
  };

  const r0: number[] = []; residuals(x0, r0);
  const M = r0.length;
  if (N === 0) {
    const bad = r0.map((v, i) => (Math.abs(v) > 1e-6 ? labels[i] : '')).filter(Boolean);
    return bad.length ? { ok: false, doc, error: 'The constrained items are all fixed or locked, so they cannot move to meet the constraints.', conflicts: [...new Set(bad)], dof: 0, iterations: 0, maxError: Math.max(...r0.map(Math.abs)) } : { ok: true, doc, conflicts: [], dof: 0, iterations: 0, maxError: 0 };
  }
  let W = 1e-4; // pull towards the current values (switched off for the final polishing steps)
  let x = x0.slice(), lambda = 1e-3, it = 0;
  const cost = (r: number[], xx: number[]) => r.reduce((s, v) => s + v * v, 0) + xx.reduce((s, v, i) => s + (W * (v - x0[i])) ** 2, 0);
  let r: number[] = []; residuals(x, r); let c0 = cost(r, x);
  const J: number[][] = Array.from({ length: M }, () => new Array<number>(N).fill(0));
  const tmp: number[] = [];
  const maxIter = opts.maxIter ?? 200;
  for (let phase = 0; phase < 2; phase++) {
  if (phase === 1) { W = 0; lambda = 1e-6; c0 = cost(r, x); }
  for (let k = 0; k < maxIter; k++, it++) {
    if (Math.max(0, ...r.map(Math.abs)) < 1e-10) break;
    for (let j = 0; j < N; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[j])), old = x[j];
      x[j] = old + h; residuals(x, tmp); x[j] = old;
      for (let i = 0; i < M; i++) J[i][j] = (tmp[i] - r[i]) / h;
    }
    // normal equations (J^T J + W^2 I + lambda diag) dx = -(J^T r + W^2 (x - x0))
    const A: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0)), g = new Array<number>(N).fill(0);
    for (let i = 0; i < M; i++) { const Ji = J[i]; for (let a = 0; a < N; a++) { if (Ji[a] === 0) continue; g[a] += Ji[a] * r[i]; for (let b = 0; b < N; b++) A[a][b] += Ji[a] * Ji[b]; } }
    for (let a = 0; a < N; a++) { A[a][a] += W * W; g[a] += W * W * (x[a] - x0[a]); }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const B = A.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v || 1) : v)));
      const dx = linSolve(B, g.map((v) => -v));
      if (!dx) { lambda *= 10; continue; }
      const xn = x.map((v, i) => v + dx[i]); const rn: number[] = []; residuals(xn, rn); const cn = cost(rn, xn);
      if (cn < c0) { x = xn; r = rn; c0 = cn; lambda = Math.max(lambda / 3, 1e-12); improved = true; break; }
      lambda *= 8;
    }
    if (!improved) break;
  }
  }
  const maxError = Math.max(0, ...r.map(Math.abs));
  // degrees of freedom left = unknowns minus independent equations
  const dof = Math.max(0, N - rankOf(J));
  if (maxError > 1e-6) {
    const bad = [...new Set(r.map((v, i) => (Math.abs(v) > 1e-6 ? labels[i] : '')).filter(Boolean))];
    return { ok: false, doc, error: `The constraints and dimensions contradict each other (remaining error ${maxError.toExponential(2)}). Nothing was changed. Remove or change one of: ${bad.join(', ')}.`, conflicts: bad, dof, iterations: it, maxError };
  }
  for (const v of x) if (!Number.isFinite(v)) return { ok: false, doc, error: 'The solver did not find a valid shape. Nothing was changed.', conflicts: [], dof, iterations: it, maxError: Infinity };
  const ents = doc.ents.map((e) => (acc.has(e.id) ? ent(x, e.id) : e));
  return { ok: true, doc: { ...doc, ents }, conflicts: [], dof, iterations: it, maxError };
}

/** Gaussian elimination with partial pivoting. null when the matrix is singular. */
export function linSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; if (f === 0) continue; for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k]; }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
export function rankOf(J: number[][]): number {
  if (!J.length) return 0;
  const M = J.map((r) => r.slice()), rows = M.length, cols = M[0].length; let rank = 0;
  const tol = 1e-7 * Math.max(1, ...M.flat().map(Math.abs));
  for (let c = 0; c < cols && rank < rows; c++) {
    let p = rank; for (let i = rank + 1; i < rows; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < tol) continue;
    [M[rank], M[p]] = [M[p], M[rank]];
    for (let i = rank + 1; i < rows; i++) { const f = M[i][c] / M[rank][c]; for (let k = c; k < cols; k++) M[i][k] -= f * M[rank][k]; }
    rank++;
  }
  return rank;
}
