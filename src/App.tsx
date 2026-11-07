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
import { TypesPage } from './pages/TypesPage.tsx';
import { ImagePage } from './pages/ImagePage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { authReady, useAuth } from './cloud/client.ts';

const NAV: [string, string][] = [['dashboard', 'Dashboard'], ['components', 'Components'], ['types', 'Component types'], ['designer', '2D / 3D Designer'], ['image', 'Image to 3D'], ['assembly', 'Assembly'], ['saved', 'Saved designs'], ['coverage', 'Coverage'], ['help', 'Help'], ['about', 'About'], ['account', 'Account']];

export default function App() {
  const r = useRoute();
  const auth = useAuth();
  useEffect(() => { void authReady(); }, []);
  const admin = !!auth.user?.isAdmin;
  const nav = (admin ? [...NAV.slice(0, -1), ['settings', 'Settings'] as [string, string], NAV[NAV.length - 1]] : NAV).map(([k, l]): [string, string] => (k === 'account' ? [k, auth.user ? auth.user.name.split(' ')[0] || 'Account' : 'Sign in'] : [k, l]));
  const [hq, setHq] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; if (e.key === '/' && t && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); document.getElementById('global-search')?.focus(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const page = r.path[0] ?? 'dashboard';
  // When the cloud database is connected, nothing is shown until the person signs in (and has been approved).
  if (!auth.ready) return <div className="app"><main><div className="page"><p className="muted">Loading...</p></div></main></div>;
  if (auth.configured && !auth.user) return <div className="app"><main><AccountPage /></main><Toaster /></div>;
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
        {page === 'types' && <TypesPage />}
        {page === 'account' && <AccountPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'saved' && <SavedPage />}
        {page === 'coverage' && <CoveragePage />}
        {page === 'help' && <HelpPage />}
        {page === 'about' && <AboutPage />}
        {!nav.some(([k]) => k === page) && page !== 'settings' && <div className="page"><h1>Page not found</h1><a href="#/dashboard">Back to dashboard</a></div>}
      </main>
      <Toaster />
      <footer><div className="foot"><Logo height={24} box /><span>Ultraplast Chainbelts Private Limited. Designs are PRELIMINARY and not validated for manufacture.</span><a href="https://www.ultraplastindia.com/" target="_blank" rel="noreferrer">ultraplastindia.com</a></div></footer>
    </div>
  );
}
