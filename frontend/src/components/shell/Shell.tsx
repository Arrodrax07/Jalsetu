import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bell, Building2, CheckCircle2, ClipboardCheck, Cpu, Droplets, FileSpreadsheet, LayoutDashboard,
  LogOut, MessageSquareWarning, Radio, RadioTower, Route, Settings2, ShieldCheck, Truck, WifiOff, X,
} from 'lucide-react';
import { useApp, useNow } from '../../context/AppContext';
import { api } from '../../services/api';
import { Button, Chip, cx, formatAge } from '../ui';

export const NAV: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Operations' },
  { id: 'live', label: 'Live Operations', icon: Radio, group: 'Operations' },
  { id: 'trips', label: 'Trips & Dispatch', icon: Route, group: 'Operations' },
  { id: 'verification', label: 'Delivery Verification', icon: ClipboardCheck, group: 'Operations' },
  { id: 'fleet', label: 'Fleet', icon: Truck, group: 'Operations' },
  { id: 'disasters', label: 'Disaster Intelligence', icon: RadioTower, group: 'Intelligence' },
  { id: 'requests', label: 'Water Requests', icon: Droplets, group: 'Demand' },
  { id: 'allocation', label: 'Allocation', icon: Cpu, group: 'Demand' },
  { id: 'communities', label: 'Communities', icon: Building2, group: 'Demand' },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning, group: 'Demand' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Insight' },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet, group: 'Insight' },
  { id: 'admin', label: 'Administration', icon: Settings2, group: 'System' },
];

const IstClock: React.FC = () => {
  const { serverOffsetMs } = useApp();
  const now = useNow(serverOffsetMs);
  return (
    <span className="num hidden text-xs text-cc-muted lg:inline" title="Server-aligned time">
      {new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })} IST
    </span>
  );
};

const HealthPill: React.FC = () => {
  const { health, navigate } = useApp();
  if (!health) return null;
  const degraded = health.sources.filter(s => ['ndma_sachet', 'osrm', 'open_meteo'].includes(s.key) && s.status === 'degraded').length
    + (health.database.status !== 'healthy' ? 1 : 0) + (health.ml.complaintClassifier !== 'healthy' ? 1 : 0);
  return (
    <button onClick={() => navigate('admin')} className="hidden md:block" title="System health">
      {degraded ? <Chip tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>{degraded} degraded</Chip>
        : <Chip tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>Systems OK</Chip>}
    </button>
  );
};

const Notifications: React.FC = () => {
  const { notifications, refresh, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const markAll = async () => { await api.markRead().catch(() => undefined); refresh('notifications'); };
  const go = (entity: string) => {
    setOpen(false);
    navigate({ trip: 'trips', vehicle: 'live', disaster: 'disasters', delivery: 'verification' }[entity] || 'overview');
  };
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" aria-label={`Notifications, ${notifications.unread} unread`} onClick={() => setOpen(o => !o)} className="relative">
        <Bell className="h-4 w-4" />
        {notifications.unread > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-cc-danger px-1 text-[10px] font-bold text-white">{notifications.unread > 99 ? '99+' : notifications.unread}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 overflow-hidden rounded-xl border border-cc-border bg-cc-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-cc-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>
              <Button size="sm" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></Button></div>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-cc-border">
            {notifications.items.length === 0 && <li className="p-4 text-sm text-cc-muted">No notifications.</li>}
            {notifications.items.map(n => (
              <li key={n.id}>
                <button onClick={() => go(n.entity)} className={cx('w-full px-3 py-2.5 text-left hover:bg-cc-hover', !n.read && 'bg-cc-accent/5')}>
                  <div className="flex items-center gap-2">
                    {n.severity === 'critical' ? <Chip tone="danger">Critical</Chip> : n.severity === 'warning' ? <Chip tone="warn">Warning</Chip> : <Chip>Info</Chip>}
                    <span className="truncate text-sm font-medium">{n.title}</span>
                  </div>
                  {n.body && <p className="mt-1 line-clamp-2 text-xs text-cc-muted">{n.body}</p>}
                  <p className="mt-0.5 text-2xs text-cc-faint">{formatAge((now - Date.parse(n.createdAt)) / 1000)} ago</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const TopBar: React.FC = () => {
  const { user, logout, wsConnected, overview, navigate } = useApp();
  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-cc-border bg-cc-surface px-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={() => navigate('overview')} className="flex items-center gap-2" aria-label="JalSetu home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cc-accent-strong/20 text-cc-accent"><Droplets className="h-4.5 w-4.5 h-[18px] w-[18px]" /></span>
          <span className="text-sm font-semibold tracking-tight">JalSetu <span className="text-cc-muted font-normal">Operations</span></span>
        </button>
        {wsConnected
          ? <Chip tone="ok" icon={<Radio className="h-3 w-3" />} title="Realtime channel connected">Live feed</Chip>
          : <Chip tone="warn" icon={<WifiOff className="h-3 w-3" />} title="Realtime channel reconnecting; polling every 10 s">Reconnecting</Chip>}
        {overview && overview.activeEmergencies > 0 && (
          <button onClick={() => navigate('disasters')}><Chip tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>{overview.activeEmergencies} severe alerts</Chip></button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <IstClock />
        <HealthPill />
        <Notifications />
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">{user?.name}</p>
          <p className="text-2xs capitalize text-cc-muted">{user?.role}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Sign out" onClick={logout}><LogOut className="h-4 w-4" /></Button>
      </div>
    </header>
  );
};

export const NavRail: React.FC = () => {
  const { route, navigate, overview } = useApp();
  const badges: Record<string, number | undefined> = {
    verification: overview?.pendingVerifications || undefined,
    disasters: overview?.activeAlerts || undefined,
    requests: overview?.criticalRequests || undefined,
    complaints: overview?.openComplaints || undefined,
  };
  const groups = useMemo(() => [...new Set(NAV.map(n => n.group))], []);
  return (
    <nav aria-label="Primary" className="hidden w-56 flex-shrink-0 flex-col overflow-y-auto border-r border-cc-border bg-cc-surface py-3 md:flex">
      {groups.map(g => (
        <div key={g} className="mb-2">
          <p className="eyebrow px-4 py-1.5">{g}</p>
          {NAV.filter(n => n.group === g).map(n => {
            const Icon = n.icon;
            const active = route === n.id || (route.startsWith(n.id + '/'));
            return (
              <button key={n.id} onClick={() => navigate(n.id)} aria-current={active ? 'page' : undefined}
                className={cx('mx-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  active ? 'bg-cc-accent/10 text-cc-text' : 'text-cc-muted hover:bg-cc-hover hover:text-cc-text')}>
                <Icon className={cx('h-4 w-4', active ? 'text-cc-accent' : '')} />
                <span className="flex-1 text-left">{n.label}</span>
                {badges[n.id] ? <span className="num rounded-full bg-cc-raised px-1.5 text-2xs text-cc-muted">{badges[n.id]}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
};

export const MobileNav: React.FC = () => {
  const { route, navigate } = useApp();
  return (
    <div className="border-b border-cc-border bg-cc-surface px-3 py-2 md:hidden">
      <select aria-label="Navigate" className="input" value={route.split('/')[0]} onChange={e => navigate(e.target.value)}>
        {NAV.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
      </select>
    </div>
  );
};

export const Toasts: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} role="status" className={cx('pointer-events-auto flex items-start gap-3 rounded-xl border bg-cc-raised p-3 shadow-pop',
          t.type === 'error' ? 'border-cc-danger/50' : t.type === 'warning' ? 'border-cc-warn/50' : t.type === 'success' ? 'border-cc-ok/50' : 'border-cc-border')}>
          {t.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-400" /> : t.type === 'info' ? <Activity className="mt-0.5 h-4 w-4 text-cc-accent" /> : <AlertTriangle className={cx('mt-0.5 h-4 w-4', t.type === 'error' ? 'text-red-400' : 'text-amber-400')} />}
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t.title}</p>{t.message && <p className="mt-0.5 text-xs text-cc-muted break-words">{t.message}</p>}</div>
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-cc-faint hover:text-cc-text"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
};


export function useTick(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT(x => x + 1), ms); return () => clearInterval(id); }, [ms]);
}
