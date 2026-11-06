import { CATEGORIES, IMPLEMENTED, PARTIAL } from '../data/catalogue.ts';
import { FAMILIES } from '../families/index.ts';
import { Logo } from '../ui/Logo.tsx';
import { useState } from 'react';
import { PageHeader } from '../ui/PageHeader.tsx';

export function CoveragePage() {
  const [q, setQ] = useState('');
  const impl = Object.keys(IMPLEMENTED).length, partial = Object.keys(PARTIAL).filter((k) => IMPLEMENTED[k]).length;
  return (
    <div className="page">
      <PageHeader title="Component coverage register" subtitle="Exactly what is implemented, partial or still pending." />
      <input className="filterbox" placeholder="Search the catalogue, e.g. sprocket, roller, frame" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalogue" />
      <p>{impl} catalogue items are covered by an implemented family ({partial} of them partially). Everything else is <b>pending</b>: no geometry or calculation exists for it yet, and nothing is claimed about it.</p>
      <h2>Implemented families</h2>
      <table className="tbl wide"><thead><tr><th>Family</th><th>Calculation</th><th>2D views</th><th>3D</th><th>STEP</th><th>Assembly</th><th>Verification</th></tr></thead><tbody>
        {FAMILIES.map((f) => <tr key={f.id}><td><b>{f.name}</b><div className="muted">{f.variants.length} variants, standards: {f.standards.join(', ')}</div></td><td>Yes</td><td>Dimensioned views + isometric</td><td>Yes</td><td>Yes</td><td>{f.asm(f.calculate(f.defaults).derived).bore !== undefined || f.asm(f.calculate(f.defaults).derived).sections ? 'Fit checks' : 'Placement, interference'}</td><td>All variants pass automated formula, drawing-layout and DXF tests. 3D view, PDF/PNG/GLB and STEP not yet run in a browser by the author.</td></tr>)}
      </tbody></table>
      <h2>Catalogue</h2>
      {CATEGORIES.map((c) => (
        <details key={c.id} open={!!q || c.items.some((i) => IMPLEMENTED[`${c.id}:${i}`])} hidden={!!q && !c.items.some((i) => `${i} ${c.name}`.toLowerCase().includes(q.toLowerCase()))}><summary><b>{c.id}</b> {c.name} ({c.items.filter((i) => IMPLEMENTED[`${c.id}:${i}`]).length}/{c.items.length})</summary>
          <ul>{c.items.filter((i) => !q || `${i} ${c.name}`.toLowerCase().includes(q.toLowerCase())).map((i) => { const k = `${c.id}:${i}`; return <li key={i}>{i}: {IMPLEMENTED[k] ? <><span className="tag ok">{PARTIAL[k] ? 'partial' : 'implemented'}</span> <span className="muted">{PARTIAL[k] ?? ''}</span></> : <span className="muted">pending</span>}</li>; })}</ul></details>
      ))}
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="page prose">
      <PageHeader title="Help" subtitle="How to go from a search to a drawing, model and CAD files." />
      <ol><li>Search for a component (for example "sprocket"; press / anywhere to search) or pick a category.</li><li>Press <b>Design</b>, or click a variant chip to start from a ready-made size.</li><li>In <b>Quick</b> mode enter only the key values; everything else is derived and listed under "Derived automatically". Switch to <b>Advanced</b> to set every parameter yourself. Errors and warnings update live; geometry is only generated when the inputs are valid.</li><li>In the 2D tab click any element to select it; click a dimension marked editable to change it.</li><li>Use the 2D drawing and 3D model tabs, then download files from the Downloads tab.</li><li>Save the design to this browser, or export a project file as a backup.</li></ol>
      <h2>Important limitations</h2>
      <ul>
        <li>All results are <b>PRELIMINARY</b>. Do not manufacture from them without engineering validation.</li>
        <li>Saved designs live only in your browser on this device; they are not synchronised and can be cleared by the browser.</li>
        <li>Sprocket teeth use the ISO 606 profile at the mean of the standard limits; tooth side chamfers are not modelled. Bearing internals are illustrative.</li>
        <li>Ultraplast proprietary chain and belt geometry is not included until the catalogue data is supplied.</li>
        <li>Assembly checks cover bore-to-shaft fits, chain consistency and interference; shaft keyways, tolerances and motion are not modelled. Interference is exact only for coaxial round parts.</li>
        <li>2D isometric views show edges without hidden-line removal.</li>
      </ul>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="page prose"><div className="about-card">
      <Logo height={70} box />
      <h1>About Ultraplast</h1>
      <p>Ultraplast Chainbelts Private Limited. Official website: <a href="https://www.ultraplastindia.com/" target="_blank" rel="noreferrer">ultraplastindia.com</a>.</p>
      <p>This tool is an engineering design assistant for preliminary conveyor component design. It does not replace review by a qualified engineer.</p>
    </div></div>
  );
}
