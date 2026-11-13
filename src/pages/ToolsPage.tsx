import { useState } from 'react';
import { chainLength, drivePower, pitchDiameter, rollerPitch, speed, throughput } from '../lib/convcalc.ts';
import type { Res } from '../lib/convcalc.ts';
import { PageHeader } from '../ui/PageHeader.tsx';

interface F { key: string; label: string; unit?: string; def: string; step?: string; hint?: string; options?: [string, string][] }
type Vals = Record<string, number>;

/** One calculator card: inputs on the left, live results on the right. Nothing is saved or sent anywhere. */
function Calc({ title, blurb, fields, run, formula, link }: { title: string; blurb: string; fields: F[]; run: (v: Vals) => Res; formula: string; link?: [string, string] }) {
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.def])));
  const v: Vals = Object.fromEntries(fields.map((f) => [f.key, raw[f.key] === '' ? NaN : Number(raw[f.key])]));
  const r = run(v);
  return (
    <section className="panel toolcard">
      <h3>{title}</h3>
      <p className="muted">{blurb}</p>
      <div className="toolgrid">
        <div>{fields.map((f) => (
          <label key={f.key} className="field"><span>{f.label}{f.unit && <em> ({f.unit})</em>}</span>
            {f.options ? <select value={raw[f.key]} onChange={(e) => setRaw({ ...raw, [f.key]: e.target.value })}>{f.options.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}</select>
              : <input type="number" inputMode="decimal" step={f.step ?? 'any'} value={raw[f.key]} onChange={(e) => setRaw({ ...raw, [f.key]: e.target.value })} />}
            {f.hint && <small>{f.hint}</small>}</label>))}</div>
        <div>
          {!r.ok ? <div className="box warn">{r.error}</div> : (<>
            <table className="tbl toolres"><tbody>{r.out.map((o, i) => <tr key={i}><td>{o.label}</td><td className="num"><b>{o.value.toLocaleString(undefined, { maximumFractionDigits: o.digits ?? 2, minimumFractionDigits: 0 })}</b> {o.unit}</td></tr>)}</tbody></table>
            {r.warnings.map((w, i) => <div key={i} className="box warn">{w}</div>)}
          </>)}
          <p className="muted"><small>Formula: {formula}</small></p>
          {link && <a className="btnlink" href={link[1]}>{link[0]}</a>}
        </div>
      </div>
    </section>
  );
}

export function ToolsPage() {
  return (
    <div className="page">
      <PageHeader title="Conveyor tools" subtitle="Quick calculators for chains, sprockets, belts, rollers and drives. Type your numbers and read the answer at once." />
      <div className="box info">These are standard textbook formulas for <b>preliminary sizing</b>. Confirm important choices with the chain or belt manufacturer's catalogue and a qualified engineer. Nothing you type here is saved.</div>
      <Calc title="Conveying speed" blurb="From the motor speed and gearbox ratio to metres per minute, for a chain (sprocket) or a belt (drum)." formula="v = teeth x pitch x rpm  (chain),  v = pi x D x rpm  (drum)"
        fields={[{ key: 'motorRpm', label: 'Motor speed', unit: 'rpm', def: '1450' }, { key: 'ratio', label: 'Gearbox ratio', unit: ': 1', def: '30', hint: 'Total reduction, for example 30 for 30:1.' }, { key: 'kind', label: 'Drive type', def: '0', options: [['0', 'Chain with drive sprocket'], ['1', 'Belt with drive drum']] }, { key: 'teeth', label: 'Sprocket teeth', def: '16' }, { key: 'pitch', label: 'Chain pitch', unit: 'mm', def: '25.4' }, { key: 'drumDia', label: 'Drum diameter', unit: 'mm', def: '200' }]}
        run={(v) => speed({ motorRpm: v.motorRpm, ratio: v.ratio, kind: v.kind === 1 ? 'drum' : 'chain', teeth: v.teeth, pitch: v.pitch, drumDia: v.drumDia })} />
      <Calc title="Throughput" blurb="How many products and how much weight the conveyor moves per hour." formula="items/min = speed / (item length + gap) x lanes"
        fields={[{ key: 'speedMmin', label: 'Speed', unit: 'm/min', def: '30' }, { key: 'itemLength', label: 'Item length (in travel direction)', unit: 'mm', def: '200' }, { key: 'gap', label: 'Gap between items', unit: 'mm', def: '100' }, { key: 'itemMass', label: 'Mass of one item', unit: 'kg', def: '2' }, { key: 'lanes', label: 'Lanes side by side', def: '1', step: '1' }]}
        run={(v) => throughput({ speedMmin: v.speedMmin, itemLength: v.itemLength, gap: v.gap, itemMass: v.itemMass, lanes: v.lanes })} />
      <Calc title="Chain length and centre distance" blurb="How many pitches of chain you need between two sprockets. The answer is rounded up to an even number so no offset link is needed." formula="L = 2C/p + (N1+N2)/2 + ((N2-N1)/2pi)^2 / (C/p)" link={['Open the sprocket designer', '#/designer/sprocket_types']}
        fields={[{ key: 'teethSmall', label: 'Small sprocket teeth', def: '19' }, { key: 'teethLarge', label: 'Large sprocket teeth', def: '57' }, { key: 'pitch', label: 'Chain pitch', unit: 'mm', def: '12.7' }, { key: 'centre', label: 'Wanted centre distance', unit: 'mm', def: '500' }]}
        run={(v) => chainLength({ teethSmall: v.teethSmall, teethLarge: v.teethLarge, pitch: v.pitch, centre: v.centre })} />
      <Calc title="Sprocket pitch diameter" blurb="The diameter of the circle through the chain pins." formula="PD = pitch / sin(180 / teeth)" link={['Open the sprocket designer', '#/designer/sprocket_types']}
        fields={[{ key: 'teeth', label: 'Number of teeth', def: '19' }, { key: 'pitch', label: 'Chain pitch', unit: 'mm', def: '12.7' }]}
        run={(v) => pitchDiameter({ teeth: v.teeth, pitch: v.pitch })} />
      <Calc title="Drive power and torque" blurb="Pulling force, motor size and shaft torque for a chain or belt conveyor, flat or on a slope." formula="F = g ((m load + m moving) x mu x cos a + m load x sin a),  P = F x v / efficiency x service factor"
        fields={[{ key: 'massLoad', label: 'Load on the conveyor at one time', unit: 'kg', def: '100' }, { key: 'massMoving', label: 'Weight of the moving chain or belt', unit: 'kg', def: '50' }, { key: 'mu', label: 'Friction coefficient', def: '0.2', hint: 'About 0.1 to 0.3 for plastic chain on steel or UHMW guides.' }, { key: 'angleDeg', label: 'Slope (up is positive)', unit: 'degrees', def: '0' }, { key: 'speedMs', label: 'Speed', unit: 'm/s', def: '0.5' }, { key: 'eta', label: 'Drive efficiency', def: '0.9', hint: '0.85 to 0.95 for gearbox plus chain.' }, { key: 'service', label: 'Service factor', def: '1.25', hint: '1.0 smooth, 1.25 normal, 1.5 or more for shocks.' }, { key: 'driveDia', label: 'Drive sprocket or drum pitch diameter', unit: 'mm', def: '200' }]}
        run={(v) => drivePower({ massLoad: v.massLoad, massMoving: v.massMoving, mu: v.mu, angleDeg: v.angleDeg, speedMs: v.speedMs, eta: v.eta, service: v.service, driveDia: v.driveDia })} />
      <Calc title="Roller conveyor pitch" blurb="How close the rollers must be so the smallest item always rests on at least three rollers." formula="max pitch = shortest item length / 3"
        fields={[{ key: 'itemLength', label: 'Shortest item length', unit: 'mm', def: '300' }, { key: 'conveyorLength', label: 'Conveyor length', unit: 'mm', def: '2000' }, { key: 'rollerDia', label: 'Roller diameter', unit: 'mm', def: '50' }]}
        run={(v) => rollerPitch({ itemLength: v.itemLength, conveyorLength: v.conveyorLength, rollerDia: v.rollerDia })} />
    </div>
  );
}
