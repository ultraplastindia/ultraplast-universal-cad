import type { ParamField, Params } from '../core/types.ts';

export function ParamForm({ fields, params, onChange }: { fields: ParamField[]; params: Params; onChange: (p: Params) => void }) {
  const set = (k: string, v: number | string | boolean) => onChange({ ...params, [k]: v });
  return (
    <div className="form">
      {fields.filter((f) => !f.showIf || f.showIf(params)).map((f) => {
        const v = params[f.key];
        const bad = f.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v));
        return (
          <label key={f.key} className={bad ? 'field bad' : 'field'}>
            <span>{f.label}{f.unit ? <em> ({f.unit})</em> : null}</span>
            {f.kind === 'number' && (
              <input type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} value={typeof v === 'number' && Number.isFinite(v) ? v : ''}
                onChange={(e) => set(f.key, e.target.value === '' ? NaN : parseFloat(e.target.value))} />
            )}
            {f.kind === 'select' && (
              <select value={String(v)} onChange={(e) => set(f.key, e.target.value)}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.kind === 'text' && <textarea rows={f.rows ?? 3} spellCheck={false} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === 'boolean' && <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />}
            {f.help ? <small>{f.help}</small> : null}
          </label>
        );
      })}
    </div>
  );
}
