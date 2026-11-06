export type V3 = [number, number, number];
export type M3 = number[]; // row-major 3x3

export const IDENT: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mul = (a: M3, b: M3): M3 => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
/** Rotation order: X first, then Y, then Z (R = Rz * Ry * Rx). Angles in degrees. */
export function rotMat(rot: V3): M3 {
  const [x, y, z] = rot.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx: M3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry: M3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz: M3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(Rz, mul(Ry, Rx));
}
export const apply = (m: M3, p: V3): V3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const xf = (m: M3, pos: V3, p: V3): V3 => add(apply(m, p), pos);
