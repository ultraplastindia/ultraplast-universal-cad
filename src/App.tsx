import { useEffect, useState } from 'react';
import { go, useRoute } from './ui/router.ts';
import { SearchBox } from './ui/SearchBox.tsx';
import { Toaster } from './ui/Toast.tsx';
import { Logo } from './ui/Logo.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ComponentsPage } from './pages/ComponentsPage.tsx';
import { DesignerPage } from './pages/DesignerPage.tsx';
import { SavedPage } from './pages/SavedPage.tsx';
import { AboutPage, CoveragePage, HelpPage } from './pages/InfoPages.tsx';
import { AssemblyPage } from './pages/AssemblyPage.tsx';
import { ImagePage } from './pages/ImagePage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { authReady, useAuth } from './cloud/client.ts';

const NAV: [string, string][] = [['dashboard', 'Dashboard'], ['components', 'Components'], ['designer', '2D / 3D Designer'], ['image', 'Image to 3D'], ['assembly', 'Assembly'], ['saved', 'Saved designs'], ['coverage', 'Coverage'], ['help', 'Help'], ['about', 'About'], ['account', 'Account']];

export default function App() {
  const r = useRoute();
  const auth = useAuth();
  useEffect(() => { void authReady(); }, []);
  const nav = NAV.map(([k, l]): [string, string] => (k === 'account' ? [k, auth.user ? auth.user.name.split(' ')[0] || 'Account' : 'Sign in'] : [k, l]));
  const [hq, setHq] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; if (e.key === '/' && t && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); document.getElementById('global-search')?.focus(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const page = r.path[0] ?? 'dashboard';
  const key = r.path.join('/') + '?' + r.query.toString();
  return (
    <div className="app">
      <header className="top">
        <a href="#/dashboard" className="brand"><Logo height={34} box /><span>Conveyor Designer<small>CAD automation</small></span></a>
        <div className="top-search"><SearchBox compact id="global-search" value={hq} onChange={setHq} onSubmit={(v) => { go(`components?q=${encodeURIComponent(v)}`); setHq(''); }} placeholder="Search components   ( / )" /></div>
        <nav>{nav.map(([k, l]) => <a key={k} href={`#/${k}`} className={page === k ? 'on' : ''}>{l}</a>)}</nav>
      </header>
      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'components' && <ComponentsPage key={key} query={r.query} />}
        {page === 'designer' && <DesignerPage key={key} familyId={r.path[1]} query={r.query} />}
        {page === 'assembly' && <AssemblyPage />}
        {page === 'image' && <ImagePage />}
        {page === 'account' && <AccountPage />}
        {page === 'saved' && <SavedPage />}
        {page === 'coverage' && <CoveragePage />}
        {page === 'help' && <HelpPage />}
        {page === 'about' && <AboutPage />}
        {!NAV.some(([k]) => k === page) && <div className="page"><h1>Page not found</h1><a href="#/dashboard">Back to dashboard</a></div>}
      </main>
      <Toaster />
      <footer><div className="foot"><Logo height={24} box /><span>Ultraplast Chainbelts Private Limited. Designs are PRELIMINARY and not validated for manufacture.</span><a href="https://www.ultraplastindia.com/" target="_blank" rel="noreferrer">ultraplastindia.com</a></div></footer>
    </div>
  );
}
