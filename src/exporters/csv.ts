import type { Design } from '../lib/design.ts';

const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
export function bomCsv(d: Design): string {
  const dims = d.family.keyDims(d.calc.derived).map((r) => `${r.label} ${r.value}${r.unit ? ' ' + r.unit : ''}`).join('; ');
  const mass = d.calc.calculated.find((r) => r.label.startsWith('Approx. mass'));
  const head = ['Item', 'Part No', 'Description', 'Material', 'Qty', 'Key dimensions', 'Approx. mass (kg)', 'Status'];
  const row = [1, d.partNo, d.family.name, d.meta.material, 1, dims, mass?.value ?? '', 'PRELIMINARY'];
  return [head, row].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
export function dimensionsCsv(d: Design): string {
  const rows: (string | number)[][] = [['Type', 'Parameter', 'Value', 'Unit']];
  d.calc.inputs.forEach((r) => rows.push(['Input', r.label, r.value, r.unit ?? '']));
  d.calc.calculated.forEach((r) => rows.push(['Calculated', r.label, r.value, r.unit ?? '']));
  d.calc.assumptions.forEach((a) => rows.push(['Assumption', a, '', '']));
  d.calc.warnings.forEach((w) => rows.push(['Warning', w, '', '']));
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
