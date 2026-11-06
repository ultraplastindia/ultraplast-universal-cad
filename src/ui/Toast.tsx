import { useEffect, useState } from 'react';

type Kind = 'ok' | 'err' | 'info';
interface T { id: number; msg: string; kind: Kind }
const EV = 'ultraplast-toast';
let nextId = 1;
export const toast = (msg: string, kind: Kind = 'ok'): void => { window.dispatchEvent(new CustomEvent(EV, { detail: { id: nextId++, msg, kind } })); };

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<T>).detail;
      setItems((a) => [...a.slice(-3), t]);
      setTimeout(() => setItems((a) => a.filter((x) => x.id !== t.id)), t.kind === 'err' ? 9000 : 3800);
    };
    window.addEventListener(EV, h);
    return () => window.removeEventListener(EV, h);
  }, []);
  return <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((a) => a.filter((x) => x.id !== t.id))}>{t.msg}</div>)}</div>;
}
