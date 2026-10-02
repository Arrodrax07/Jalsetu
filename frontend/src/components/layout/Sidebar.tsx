import React from 'react';
import {
  LayoutDashboard, FileText, AlertCircle, Users, Cpu, Route, Navigation, CheckSquare, BarChart3, FileSpreadsheet, Settings, Activity, Droplet,
} from 'lucide-react';
import { useWaterData } from '../../context/WaterDataContext';
import { pct } from '../../utils/format';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeColor?: string;
}

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, requests, complaints, tankers, communities, deliveries, dashboard } = useWaterData();

  const pendingRequests = requests.filter(r => r.status === 'Pending').length;
  const openComplaints = complaints.filter(c => c.status !== 'Resolved').length;
  const activeTankers = tankers.filter(t => t.status === 'En Route' || t.status === 'Loading').length;
  const toVerify = deliveries.filter(d => d.status === 'Pending Verification' || d.status === 'Mismatch').length;
  const operational = tankers.filter(t => t.status !== 'Maintenance').length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'requests', label: 'Requests', icon: FileText, badge: pendingRequests || undefined, badgeColor: 'bg-amber-100 text-amber-800' },
    { id: 'complaints', label: 'Complaints', icon: AlertCircle, badge: openComplaints || undefined, badgeColor: 'bg-rose-100 text-rose-800' },
    { id: 'communities', label: 'Communities', icon: Users, badge: communities.length || undefined },
    { id: 'demandAnalysis', label: 'Demand & Forecast', icon: Activity },
    { id: 'allocation', label: 'Allocation AI', icon: Cpu, badge: 'AI', badgeColor: 'bg-sky-100 text-sky-800 font-bold' },
    { id: 'routeOptimizer', label: 'Route & Dispatch', icon: Route },
    { id: 'tracking', label: 'Live Tracking', icon: Navigation, badge: tankers.length ? `${activeTankers}/${tankers.length}` : undefined, badgeColor: 'bg-emerald-100 text-emerald-800' },
    { id: 'deliveryVerification', label: 'Delivery Verification', icon: CheckSquare, badge: toVerify || undefined, badgeColor: 'bg-amber-100 text-amber-800' },
    { id: 'impactAnalytics', label: 'Impact Analytics', icon: BarChart3 },
    { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 hidden md:flex flex-col flex-shrink-0 border-r border-slate-800 select-none min-h-screen">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-400 flex items-center justify-center">
          <Droplet className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Navigation</h2>
          <p className="text-xs text-slate-200 font-medium">Urban Water Command</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)} aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 group ${
                isActive ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'}`}>
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : item.badgeColor || 'bg-slate-800 text-slate-300'}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400 font-medium">Fleet operational</span>
            <span className="text-emerald-400 font-bold">{operational} / {tankers.length}</span>
          </div>
          <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${tankers.length ? (100 * operational) / tankers.length : 0}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Need-weighted equity: <span className="text-white font-semibold">{pct(dashboard?.coverageBalance, 1)}</span>
          </p>
        </div>
      </div>
    </aside>
  );
};
