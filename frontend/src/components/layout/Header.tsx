import React, { useEffect, useMemo, useState } from 'react';
import { Droplets, Search, Bell, Shield, UserCheck, LogOut, ChevronDown, Clock, Radio, AlertTriangle, WifiOff } from 'lucide-react';
import { useWaterData } from '../../context/WaterDataContext';
import { timeAgo } from '../../utils/format';

interface Alert {
  key: string;
  tone: 'rose' | 'amber';
  title: string;
  body: string;
  at: string | null;
  tab: string;
}

export const Header: React.FC = () => {
  const { currentUser, logout, requests, complaints, deliveries, tankers, communities, setActiveTab, setSelectedCommunity, isLive } = useWaterData();

  const [currentTime, setCurrentTime] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    requests.filter(r => r.urgency === 'Critical' && r.status === 'Pending').forEach(r => out.push({
      key: r.id, tone: 'rose', title: `Critical request ${r.id}: ${r.communityName}`,
      body: `${r.requestedAmount.toLocaleString()} L requested · ${r.daysWithoutWater} day(s) without water`, at: r.submittedAt, tab: 'requests',
    }));
    complaints.filter(c => c.severity === 'Critical' && c.status !== 'Resolved').forEach(c => out.push({
      key: c.id, tone: 'rose', title: `Critical complaint ${c.id}: ${c.communityName}`, body: c.category, at: c.submittedAt, tab: 'complaints',
    }));
    deliveries.filter(d => d.status === 'Mismatch').forEach(d => out.push({
      key: d.id, tone: 'amber', title: `Delivery ${d.id} flagged`, body: d.notes || `${d.varianceAmount.toLocaleString()} L variance`, at: d.deliveryTime, tab: 'deliveryVerification',
    }));
    tankers.filter(t => t.isDisrupted).forEach(t => out.push({
      key: t.id, tone: 'amber', title: `${t.vehicleNumber} out of service`, body: t.breakdownNote || 'Maintenance', at: null, tab: 'tracking',
    }));
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [requests, complaints, deliveries, tankers]);

  const results = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const res: { type: string; title: string; subtitle: string; action: () => void }[] = [];
    communities.filter(c => c.name.toLowerCase().includes(q) || c.ward.toLowerCase().includes(q)).forEach(c => res.push({
      type: 'Community', title: c.name, subtitle: `${c.ward} · ${c.currentCoverage}% coverage · ${c.status}`,
      action: () => { setSelectedCommunity(c); setActiveTab('communities'); },
    }));
    requests.filter(r => r.id.toLowerCase().includes(q) || r.communityName.toLowerCase().includes(q)).forEach(r => res.push({
      type: 'Request', title: `${r.id} (${r.communityName})`, subtitle: `${r.requestedAmount.toLocaleString()} L · ${r.urgency} · ${r.status}`,
      action: () => setActiveTab('requests'),
    }));
    complaints.filter(c => c.id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)).forEach(c => res.push({
      type: 'Complaint', title: `${c.id} (${c.communityName})`, subtitle: `${c.category} · ${c.status}`, action: () => setActiveTab('complaints'),
    }));
    tankers.filter(t => t.id.toLowerCase().includes(q) || t.vehicleNumber.toLowerCase().includes(q) || t.driverName.toLowerCase().includes(q)).forEach(t => res.push({
      type: 'Tanker', title: t.vehicleNumber, subtitle: `${t.driverName} · ${t.status}`, action: () => setActiveTab('tracking'),
    }));
    return res.slice(0, 8);
  }, [searchQuery, communities, requests, complaints, tankers, setActiveTab, setSelectedCommunity]);

  const toneClass = { rose: 'text-rose-600', amber: 'text-amber-600' };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-subtle">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-card">
            <Droplets className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-1.5">
                JalSetu <span className="text-sky-600 font-extrabold text-sm px-1.5 py-0.5 rounded bg-sky-100/80 border border-sky-200">AI</span>
              </h1>
              {isLive ? (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Radio className="w-3 h-3 text-emerald-500 animate-pulse" /> Live
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200" title="Realtime channel reconnecting; data refreshes every 15 s">
                  <WifiOff className="w-3 h-3" /> Reconnecting
                </span>
              )}
            </div>
            <p className="text-[11px] font-medium text-slate-500 hidden sm:block">{currentUser?.ward || 'Fair Water. Stronger Communities.'}</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-md hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="search" aria-label="Search" placeholder="Search communities, requests, complaints, tankers…" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all" />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-elevated border border-slate-200 py-2 z-50">
              {results.map((r, i) => (
                <button key={i} onClick={() => { r.action(); setSearchQuery(''); }} className="w-full px-3 py-2 text-left hover:bg-slate-50 group">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-900 group-hover:text-sky-600">{r.title}</span>
                    <span className="text-[10px] px-1.5 rounded bg-slate-100 text-slate-500">{r.type}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">{r.subtitle}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-500" /> <span>{currentTime} IST</span>
          </div>

          <div className="relative">
            <button onClick={() => { setShowNotif(!showNotif); setShowUserMenu(false); }} aria-label="Alerts"
              className="relative p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors">
              <Bell className="w-4 h-4" />
              {alerts.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />}
            </button>
            {showNotif && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-elevated border border-slate-200 py-3 z-50">
                <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Alerts</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold">{alerts.length} open</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                  {alerts.length === 0 && <p className="p-4 text-xs text-slate-500">No open alerts.</p>}
                  {alerts.slice(0, 20).map(a => (
                    <button key={a.key} className="w-full text-left p-3 hover:bg-slate-50" onClick={() => { setActiveTab(a.tab); setShowNotif(false); }}>
                      <div className={`flex items-center gap-2 text-xs font-semibold ${toneClass[a.tone]}`}>
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {a.title}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{a.body}</p>
                      {a.at && <span className="text-[10px] text-slate-400 mt-1 block">{timeAgo(a.at)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => { setShowUserMenu(!showUserMenu); setShowNotif(false); }}
              className="flex items-center gap-2 p-1.5 pl-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-800 transition-colors">
              <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                {currentUser?.role === 'admin' ? <Shield className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold leading-tight text-slate-900">{currentUser?.name.split(' ')[0]}</p>
                <p className="text-[10px] text-slate-500 capitalize">{currentUser?.role}</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-elevated border border-slate-200 py-2 z-50">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{currentUser?.name}</p>
                  <p className="text-[11px] text-slate-500">{currentUser?.email}</p>
                  <p className="text-[11px] text-slate-500">{currentUser?.designation}</p>
                </div>
                <div className="p-1">
                  <button onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                    <LogOut className="w-3.5 h-3.5" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
