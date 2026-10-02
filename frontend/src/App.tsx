import React from 'react';
import { Loader2 } from 'lucide-react';
import { useWaterData, WaterDataProvider } from './context/WaterDataContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/common/ToastContainer';
import { Login } from './pages/Login';
import { CitizenPortal } from './pages/CitizenPortal';
import { DriverApp } from './pages/DriverApp';

import { Dashboard } from './pages/Dashboard';

// Heavier pages are code-split and loaded on first visit.
const lazyPage = (load: () => Promise<Record<string, React.FC>>, name: string) =>
  React.lazy(() => load().then(m => ({ default: m[name] })));
const Requests = lazyPage(() => import('./pages/Requests'), 'Requests');
const Complaints = lazyPage(() => import('./pages/Complaints'), 'Complaints');
const DemandAnalysis = lazyPage(() => import('./pages/DemandAnalysis'), 'DemandAnalysis');
const Communities = lazyPage(() => import('./pages/Communities'), 'Communities');
const Allocation = lazyPage(() => import('./pages/Allocation'), 'Allocation');
const RouteOptimizer = lazyPage(() => import('./pages/RouteOptimizer'), 'RouteOptimizer');
const Tracking = lazyPage(() => import('./pages/Tracking'), 'Tracking');
const DeliveryVerification = lazyPage(() => import('./pages/DeliveryVerification'), 'DeliveryVerification');
const ImpactAnalytics = lazyPage(() => import('./pages/ImpactAnalytics'), 'ImpactAnalytics');
const Reports = lazyPage(() => import('./pages/Reports'), 'Reports');
const Settings = lazyPage(() => import('./pages/Settings'), 'Settings');

const PAGES: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  requests: Requests,
  complaints: Complaints,
  demandAnalysis: DemandAnalysis,
  communities: Communities,
  allocation: Allocation,
  routeOptimizer: RouteOptimizer,
  tracking: Tracking,
  deliveryVerification: DeliveryVerification,
  impactAnalytics: ImpactAnalytics,
  reports: Reports,
  settings: Settings,
};

const FullScreenLoader: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm gap-2">
    <Loader2 className="w-5 h-5 animate-spin text-sky-600" /> {label}
  </div>
);

const NAV_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', requests: 'Requests', complaints: 'Complaints', communities: 'Communities', demandAnalysis: 'Demand & Forecast',
  allocation: 'Allocation AI', routeOptimizer: 'Route & Dispatch', tracking: 'Live Tracking', deliveryVerification: 'Delivery Verification',
  impactAnalytics: 'Impact Analytics', reports: 'Reports', settings: 'Settings',
};

const MobileNav: React.FC = () => {
  const { activeTab, setActiveTab } = useWaterData();
  return (
    <div className="md:hidden px-4 py-2 bg-slate-900">
      <select aria-label="Navigate" value={activeTab} onChange={e => setActiveTab(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white text-sm">
        {Object.entries(NAV_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
};

const MainLayout: React.FC = () => {
  const { currentUser, authChecked, activeTab, isLoading } = useWaterData();

  if (!authChecked) return <FullScreenLoader label="Checking session…" />;
  if (!currentUser) return <Login />;
  if (currentUser.role === 'driver') return <DriverApp />;

  const Page = PAGES[activeTab] || Dashboard;
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      <Header />
      <MobileNav />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto max-w-7xl mx-auto w-full">
          {isLoading ? <FullScreenLoader label="Loading live data…" /> : <React.Suspense fallback={<FullScreenLoader label="Loading…" />}><Page /></React.Suspense>}
        </main>
      </div>
    </div>
  );
};

export function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/report') {
    return <CitizenPortal />;
  }
  return (
    <WaterDataProvider>
      <MainLayout />
      <ToastContainer />
    </WaterDataProvider>
  );
}

export default App;
