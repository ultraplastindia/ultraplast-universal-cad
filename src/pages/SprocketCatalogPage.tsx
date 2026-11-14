import { useMemo, useState } from 'react';
import { ROLLER_CHAINS } from '../data/chains.ts';
import { CATALOG_HEAD, SPROCKET_CATALOG, SPROCKET_GROUPS, entryToRows } from '../data/sprocketCatalog.ts';
import type { SprocketEntry, SprocketGroup } from '../data/sprocketCatalog.ts';
import { multiDefaults } from '../families/sprocket/multi.ts';
import { SPROCKET_MATERIALS } from '../families/sprocket/calc.ts';
import { go } from '../ui/router.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { toast } from '../ui/Toast.tsx';
import type { Params } from '../core/types.ts';

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;
function downloadCsv(list: SprocketEntry[]) {
  const text = '﻿' + [CATALOG_HEAD, ...list.map(entryToRows)].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = 'ultraplast-sprocket-catalogue.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** One catalogue entry: the four blocks of text plus a small "customise" form that opens the designer with the changed values. */
function Card({ e }: { e: SprocketEntry }) {
  const p0 = e.params;
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState(String(p0.chain));
  const [teeth, setTeeth] = useState(String(p0.teeth));
  const [bore, setBore] = useState(String(p0.bore));
  const [strands, setStrands] = useState(String(p0.strands ?? 1));
  const [material, setMaterial] = useState(String(p0.material));
  const custom = p0.chain === 'CUSTOM';
  const launch = () => {
    const z = Math.round(Number(teeth)), b = Number(bore), n = Math.round(Number(strands));
    if (!(z >= 6 && z <= 150)) { toast('Teeth must be a whole number from 6 to 150.', 'err'); return; }
    if (!(b >= 5 && b <= 200)) { toast('Bore must be from 5 to 200 mm.', 'err'); return; }
    if (!(n >= 1 && n <= 6)) { toast('Strands must be from 1 to 6.', 'err'); return; }
    // Start from the entry's values, then apply what was typed. A different chain or strand count needs its own chain data and strand spacing.
    const over: Params = { ...p0, teeth: z, bore: b, strands: n, material };
    const chainChanged = !custom && chain !== p0.chain;
    if (chainChanged) { over.chain = chain; delete over.pitch; delete over.rollerDia; delete over.innerWidth; }
    if (chainChanged || n !== Number(p0.strands ?? 1)) delete over.strandPitch;
    if (Number(p0.hubDia) > 0) over.hubDia = Math.max(Number(p0.hubDia), b + 8);
    if (Number(p0.boltCount) > 0) { const bd = Number(p0.boltDia); over.boltPcd = Math.max(Number(p0.boltPcd), b + bd + 14); over.hubDia = Math.max(Number(over.hubDia), Number(over.boltPcd) + bd + 6); }
    const params: Params = multiDefaults(String(over.chain), z, over);
    try { sessionStorage.setItem('ultraplast.preset', JSON.stringify({ familyId: 'sprocket_types', params, name: e.name })); } catch { /* designer opens with default values */ }
    go(`designer/sprocket_types?preset=${Date.now()}`);
  };
  const row = (k: string, v: string) => <tr><th style={{ width: 170, verticalAlign: 'top', textAlign: 'left' }}>{k}</th><td>{v}</td></tr>;
  return (
    <section className="panel" id={e.id} style={{ marginBottom: 14 }}>
      <h3 style={{ marginBottom: 4 }}>{e.name} <small className="muted">({e.group})</small></h3>
      <p>{e.overview}</p>
      <table className="tbl"><tbody>
        {row('Standard materials', e.materials)}{row('Bore options', e.bores)}{row('Chain compatibility', e.chains)}
        {row('Load duty', e.duty)}{row('Primary applications', e.applications)}{row('Key advantages', e.advantages)}{row('Maintenance benefits', e.maintenance)}{row('Customisable values', e.custom)}
      </tbody></table>
      {e.modelNote && <div className="box warn" style={{ marginTop: 8 }}><b>Model note:</b> {e.modelNote}</div>}
      <p style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Hide values' : 'Customise values'}</button>{' '}
        <button className="btn primary" onClick={launch}>Open in designer</button>
      </p>
      {open && (
        <div className="toolgrid">
          <div>
            {!custom && <label className="field"><span>Roller chain</span><select value={chain} onChange={(ev) => setChain(ev.target.value)}>{ROLLER_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.id} (pitch {c.pitch} mm)</option>)}</select></label>}
            <label className="field"><span>Number of teeth <em>(6 to 150)</em></span><input type="number" value={teeth} onChange={(ev) => setTeeth(ev.target.value)} /></label>
            <label className="field"><span>Bore <em>(mm)</em></span><input type="number" value={bore} onChange={(ev) => setBore(ev.target.value)} /></label>
          </div>
          <div>
            <label className="field"><span>Strands <em>(1 to 6)</em></span><input type="number" value={strands} onChange={(ev) => setStrands(ev.target.value)} /></label>
            <label className="field"><span>Material</span><select value={material} onChange={(ev) => setMaterial(ev.target.value)}>{SPROCKET_MATERIALS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <small className="muted">Everything else (hub, bolts, keyway, tip diameter) can be changed in the designer, which checks every value.</small>
          </div>
        </div>
      )}
    </section>
  );
}

export default function SprocketCatalogPage() {
  const [group, setGroup] = useState<SprocketGroup | 'All'>('All');
  const [q, setQ] = useState('');
  const list = useMemo(() => SPROCKET_CATALOG.filter((e) => (group === 'All' || e.group === group) && (!q.trim() || [e.name, e.overview, e.applications, e.chains, e.materials, e.bores].join(' ').toLowerCase().includes(q.trim().toLowerCase()))), [group, q]);
  return (
    <div className="page">
      <PageHeader title="Sprocket catalogue" subtitle="22 conveyor sprocket types: hub styles, strand capacities, mounting and bores, and conveyor applications. Customise the values and open any type in the designer.">
        <button className="btn" onClick={() => downloadCsv(list)}>Download table (CSV)</button>
      </PageHeader>
      <div className="box info"><b>How to read this:</b> sizes in each starting design are typical values to begin from, not ratings. Confirm chain strength, shaft fit and load with the chain maker and your own calculation. Some mounting styles (taper bush, QD bushing, square bore, split halves, segmental rim, modular belt and table-top tooth forms) are approximated in the 3D model: each entry says what is not drawn.</div>
      <p style={{ margin: '10px 0' }}>
        {(['All', ...SPROCKET_GROUPS] as const).map((g) => <button key={g} className={`btn${group === g ? ' primary' : ''}`} onClick={() => setGroup(g)} style={{ marginRight: 6 }}>{g}</button>)}
        <input type="search" placeholder="Search (for example split, plastic, 25.4)" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ marginLeft: 8, minWidth: 260 }} />
      </p>
      {list.length === 0 ? <p className="muted">No sprocket type matches that search.</p> : list.map((e) => <Card key={e.id} e={e} />)}
    </div>
  );
}
