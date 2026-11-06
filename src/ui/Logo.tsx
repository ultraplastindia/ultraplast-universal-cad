import { useState } from 'react';

/** Uses the real company logo at /assets/Logo.png. If the file has not been added yet, shows the company name instead. */
export function Logo({ height = 38, box = false }: { height?: number; box?: boolean }) {
  const [ok, setOk] = useState(true);
  const inner = ok ? <img src="/assets/Logo.png" alt="Ultraplast Chainbelts" height={height} style={{ height, width: 'auto', display: 'block' }} onError={() => setOk(false)} /> : <strong className="logo-fallback">ULTRAPLAST</strong>;
  return box ? <span className="logo-box">{inner}</span> : inner;
}
