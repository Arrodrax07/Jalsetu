import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { MobileNav, NavRail, Toasts, TopBar } from './components/shell/Shell';
import { FadeSwap, Loading } from './components/ui';
import { Intro, useIntro } from './components/Intro';
import { ChangePassword, Login } from './pages/Auth';
import { CommandCenter } from './pages/CommandCenter';
import { DriverApp } from './driver/DriverApp';
import { CitizenPortal } from './pages/CitizenPortal';
import { Landing } from './pages/Landing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyPage = (load: () => Promise<any>, name: string) =>
  React.lazy(() => load().then(m => ({ default: m[name] as React.ComponentType<any> })));
const LiveOperations = lazyPage(() => import('./pages/LiveOperations'), 'LiveOperations');
const Trips = lazyPage(() => import('./pages/Trips'), 'Trips');
const Verification = lazyPage(() => import('./pages/Verification'), 'Verification');
const Fleet = lazyPage(() => import('./pages/Fleet'), 'Fleet');
const Disasters = lazyPage(() => import('./pages/Disasters'), 'Disasters');
const Requests = lazyPage(() => import('./pages/Requests'), 'Requests');
const Allocation = lazyPage(() => import('./pages/Allocation'), 'Allocation');
const Communities = lazyPage(() => import('./pages/Communities'), 'Communities');
const Complaints = lazyPage(() => import('./pages/Complaints'), 'Complaints');
const Analytics = lazyPage(() => import('./pages/Analytics'), 'Analytics');
const Reports = lazyPage(() => import('./pages/Reports'), 'Reports');
const Admin = lazyPage(() => import('./pages/Admin'), 'Admin');

const Routed: React.FC = () => {
  const { route } = useApp();
  const [page, ...rest] = route.split('/');
  switch (page) {
    case 'live': return <LiveOperations />;
    case 'trips': return <Trips tripRef={rest[0]} />;
    case 'verification': return <Verification />;
    case 'fleet': return <Fleet />;
    case 'disasters': return <Disasters />;
    case 'requests': return <Requests />;
    case 'allocation': return <Allocation />;
    case 'communities': return <Communities />;
    case 'complaints': return <Complaints />;
    case 'analytics': return <Analytics />;
    case 'reports': return <Reports />;
    case 'admin': return <Admin />;
    default: return <CommandCenter />;
  }
};

const Root: React.FC = () => {
  const { user, authChecked, route } = useApp();
  // Every page load starts on the landing page (it lives only in memory, so a refresh resets it).
  // "Open the control room" enters the app; an existing session goes straight in, otherwise sign-in.
  const [entered, setEntered] = React.useState(() => window.location.pathname.startsWith('/login'));
  if (!entered) return <Landing onEnter={() => { window.history.replaceState(null, '', '/#overview'); setEntered(true); }} />;
  if (!authChecked) return <Loading label="Restoring session…" className="h-full" />;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;
  if (user.role === 'driver') return <DriverApp />;
  const fullBleed = ['overview', '', 'live'].includes(route.split('/')[0]);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <MobileNav />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className={fullBleed ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 overflow-y-auto'}>
          <React.Suspense fallback={<Loading />}>
            <FadeSwap k={route.split('/')[0] || 'overview'} className={fullBleed ? 'h-full' : 'mx-auto w-full max-w-[1600px]'}><Routed /></FadeSwap>
          </React.Suspense>
        </main>
      </div>
    </div>
  );
};

const WithIntro: React.FC = () => {
  const [intro, done] = useIntro();
  return <>{<Root />}{intro && <Intro onDone={done} />}</>;
};

export function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/report') return <CitizenPortal />;
  // Public story page, also reachable while signed in (e.g. to show visitors).
  if (window.location.pathname.replace(/\/$/, '') === '/welcome') return <Landing />;
  // Dev-only design preview of the sign-in screen without ending the current session (stripped from production builds).
  if (import.meta.env.DEV && window.location.pathname === '/__login') return <AppProvider><Login /></AppProvider>;
  return (
    <AppProvider>
      <WithIntro />
      <Toasts />
    </AppProvider>
  );
}

export default App;
