import React from 'react';
import { useWaterData, WaterDataProvider } from './context/WaterDataContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { PitchDemoBar } from './components/layout/PitchDemoBar';
import { ToastContainer } from './components/common/ToastContainer';
import { Login } from './pages/Login';

// Pages
import { Dashboard } from './pages/Dashboard';
import { Requests } from './pages/Requests';
import { Complaints } from './pages/Complaints';
import { DemandAnalysis } from './pages/DemandAnalysis';
import { Communities } from './pages/Communities';
import { Allocation } from './pages/Allocation';
import { RouteOptimizer } from './pages/RouteOptimizer';
import { Tracking } from './pages/Tracking';
import { DeliveryVerification } from './pages/DeliveryVerification';
import { ImpactAnalytics } from './pages/ImpactAnalytics';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

const MainLayout: React.FC = () => {
  const { currentUser, activeTab } = useWaterData();

  if (!currentUser) {
    return <Login />;
  }

  const renderActivePage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'requests':
        return <Requests />;
      case 'complaints':
        return <Complaints />;
      case 'demandAnalysis':
        return <DemandAnalysis />;
      case 'communities':
        return <Communities />;
      case 'allocation':
        return <Allocation />;
      case 'routeOptimizer':
        return <RouteOptimizer />;
      case 'tracking':
        return <Tracking />;
      case 'deliveryVerification':
        return <DeliveryVerification />;
      case 'impactAnalytics':
        return <ImpactAnalytics />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      {/* 11-Step Interactive Hackathon Pitch Bar */}
      <PitchDemoBar />

      {/* Top Application Header */}
      <Header />

      {/* App Body: Sidebar + Dynamic Main View */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 p-6 overflow-y-auto max-w-7xl mx-auto w-full">
          {renderActivePage()}
        </main>
      </div>

      {/* Persistent Toast Notifications */}
      <ToastContainer />
    </div>
  );
};

export function App() {
  return (
    <WaterDataProvider>
      <MainLayout />
    </WaterDataProvider>
  );
}

export default App;
