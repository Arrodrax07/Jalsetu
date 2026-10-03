import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Building2, CheckCircle2, ClipboardCheck, Command, Cpu, Droplets, FileSpreadsheet,
  LayoutDashboard, LogOut, MessageSquareWarning, Radio, RadioTower, Route, Search, Settings2, ShieldCheck, Sparkles, Truck, WifiOff, X,
} from 'lucide-react';
import { useApp, useNow } from '../../context/AppContext';
import { api } from '../../services/api';
import { Button, Chip, cx, EASE, formatAge, SPRING } from '../ui';

export const NAV: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string; group: string; hint?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Operations', hint: 'State map, crisis signals, KPIs' },
  { id: 'live', label: 'Live operations', icon: Radio, group: 'Operations', hint: 'Vehicles on the road' },
  { id: 'trips', label: 'Trips & dispatch', icon: Route, group: 'Operations', hint: 'Auto-dispatch proposals, trip records' },
  { id: 'verification', label: 'Delivery verification', icon: ClipboardCheck, group: 'Operations' },
  { id: 'fleet', label: 'Fleet', icon: Truck, group: 'Operations' },
  { id: 'disasters', label: 'Disaster intelligence', icon: RadioTower, group: 'Intelligence', hint: 'Official NDMA alerts' },
  { id: 'requests', label: 'Water requests', icon: Droplets, group: 'Demand' },
  { id: 'allocation', label: 'Allocation', icon: Cpu, group: 'Demand', hint: 'Fair-share optimiser' },
  { id: 'communities', label: 'Communities', icon: Building2, group: 'Demand' },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning, group: 'Demand' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Insight' },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet, group: 'Insight' },
  { id: 'admin', label: 'Administration', icon: Settings2, group: 'System' },
];

/** The JalSetu mark: a drop whose lower half is a bridge arch ("jal" water + "setu" bridge). */
export const Mark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden>
    <path d="M16 3.5c-4.6 6-8.5 10.6-8.5 15.2A8.5 8.5 0 0 0 16 27.2a8.5 8.5 0 0 0 8.5-8.5C24.5 14.1 20.6 9.5 16 3.5Z" fill="currentColor" />
    <path d="M9.6 21.2c1.8-3 4-4.4 6.4-4.4s4.6 1.4 6.4 4.4" fill="none" stroke="#F5F3EE" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12.3 19.2v3.1M16 16.8v4.6M19.7 19.2v3.1" stroke="#F5F3EE" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const IstClock: React.FC = () => {
  const { serverOffsetMs } = useApp();
  const now = useNow(serverOffsetMs);
  const d = new Date(now);
  return (
    <div className="hidden text-right leading-tight lg:block" title="Server-aligned time (IST)">
      <p className="num text-[13px] font-medium text-cc-text">{d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}</p>
      <p className="text-[10.5px] text-cc-faint">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} · IST</p>
    </div>
  );
};

const Notifications: React.FC = () => {
  const { notifications, refresh, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const markAll = async () => { await api.markRead().catch(() => undefined); refresh('notifications'); };
  const go = (entity: string) => {
    setOpen(false);
    navigate({ trip: 'trips', vehicle: 'live', disaster: 'disasters', delivery: 'verification', crisis_signal: 'overview' }[entity] || 'overview');
  };
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" aria-label={`Notifications, ${notifications.unread} unread`} onClick={() => setOpen(o => !o)} className="relative h-9 w-9 !rounded-full !p-0">
        <Bell className="h-[18px] w-[18px]" />
        {notifications.unread > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
            className="num absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-cc-danger px-1 text-center text-[10px] font-semibold leading-[17px] text-white ring-2 ring-cc-surface">
            {notifications.unread > 99 ? '99+' : notifications.unread}
          </motion.span>
        )}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE }} style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-40 mt-2 w-[400px] overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-cc-border px-4 py-3">
              <p className="display text-xl">Notifications</p>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>
                <Button size="sm" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></Button></div>
            </div>
            <ul className="max-h-[60vh] divide-y divide-cc-border overflow-y-auto">
              {notifications.items.length === 0 && <li className="p-6 text-center text-sm text-cc-muted">You're all caught up.</li>}
              {notifications.items.map(n => (
                <li key={n.id}>
                  <button onClick={() => go(n.entity)} className={cx('w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60', !n.read && 'bg-cc-accent/[0.035]')}>
                    <div className="flex items-center gap-2">
                      {!n.read && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cc-accent" aria-label="unread" />}
                      {n.severity === 'critical' ? <Chip tone="danger">Critical</Chip> : n.severity === 'warning' ? <Chip tone="warn">Warning</Chip> : <Chip>Info</Chip>}
                      <span className="truncate text-sm font-medium">{n.title}</span>
                    </div>
                    {n.body && <p className="mt-1 line-clamp-2 text-xs text-cc-muted">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-cc-faint">{formatAge((now - Date.parse(n.createdAt)) / 1000)} ago</p>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------- command palette
type Cmd = { id: string; label: string; hint?: string; icon: React.ComponentType<{ className?: string }>; run: () => void; group: string };

const CommandPalette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { navigate, communities, can, toast, refresh } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  const items: Cmd[] = useMemo(() => {
    const go = (r: string) => () => { navigate(r); onClose(); };
    const base: Cmd[] = NAV.map(n => ({ id: `nav-${n.id}`, label: n.label, hint: n.hint, icon: n.icon, run: go(n.id), group: 'Go to' }));
    if (can('dispatch')) base.push({ id: 'act-plan', label: 'Plan trips now', hint: 'Generate auto-dispatch proposals', icon: Sparkles, group: 'Actions',
      run: async () => { onClose(); try { const r = await api.propose(); toast('Proposals ready', `${r.proposed} trip(s) proposed`, 'success'); refresh('proposals'); navigate('trips'); } catch (e) { toast('Could not plan', String(e), 'error'); } } });
    if (can('run_ingestion')) base.push({ id: 'act-signals', label: 'Refresh crisis signals', hint: 'Pull news + rainfall now', icon: Activity, group: 'Actions',
      run: async () => { onClose(); toast('Refreshing signals', 'This can take up to a minute.', 'info'); try { const r = await api.refreshCrisis(); toast('Signals refreshed', `${r.inCrisis} communities in crisis`, 'success'); refresh('signals', 'communities'); } catch (e) { toast('Refresh failed', String(e), 'error'); } } });
    const needle = q.trim().toLowerCase();
    const places: Cmd[] = needle.length >= 2 ? communities.filter(c => c.name.toLowerCase().includes(needle)).slice(0, 8).map(c => ({
      id: `c-${c.id}`, label: c.name, hint: `${c.districtName ?? ''} · ${c.population.toLocaleString('en-IN')} people · ${c.status}`, icon: Building2, group: 'Communities',
      run: () => { navigate(`overview/${c.id}`); onClose(); },
    })) : [];
    const filtered = base.filter(i => !needle || i.label.toLowerCase().includes(needle) || i.hint?.toLowerCase().includes(needle));
    return [...filtered, ...places];
  }, [q, communities, navigate, onClose, can, toast, refresh]);

  useEffect(() => { setSel(s => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % Math.max(1, items.length)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + items.length) % Math.max(1, items.length)); }
    if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
    if (e.key === 'Escape') onClose();
  };
  let lastGroup = '';
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.button aria-label="Close" className="absolute inset-0 bg-cc-text/25 backdrop-blur-[3px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.22, ease: EASE }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-pop">
            <div className="flex items-center gap-3 border-b border-cc-border px-4">
              <Search className="h-4 w-4 text-cc-faint" />
              <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={key} placeholder="Search pages, actions or any town / village…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-cc-faint" />
              <kbd className="rounded-md border border-cc-border px-1.5 py-0.5 text-[10px] text-cc-faint">ESC</kbd>
            </div>
            <ul className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && <li className="p-6 text-center text-sm text-cc-muted">No matches for “{q}”.</li>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
                const Icon = it.icon;
                return (
                  <React.Fragment key={it.id}>
                    {header && <li className="eyebrow px-3 pb-1 pt-3">{header}</li>}
                    <li>
                      <button onMouseEnter={() => setSel(i)} onClick={it.run}
                        className={cx('relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', sel === i ? 'text-cc-text' : 'text-cc-muted')}>
                        {sel === i && <motion.span layoutId="cmd-sel" className="absolute inset-0 rounded-xl bg-cc-hover" transition={SPRING} />}
                        <Icon className="relative h-4 w-4 flex-shrink-0" />
                        <span className="relative min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-cc-text">{it.label}</span>
                          {it.hint && <span className="block truncate text-xs text-cc-muted">{it.hint}</span>}
                        </span>
                        {sel === i && <ArrowRight className="relative h-4 w-4 text-cc-faint" />}
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-cc-border bg-cc-raised px-4 py-2 text-[11px] text-cc-faint">
              <span><kbd className="font-sans">↑↓</kbd> move</span><span><kbd className="font-sans">↵</kbd> open</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------- top bar
export const TopBar: React.FC = () => {
  const { route, wsConnected, overview, navigate } = useApp();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const page = NAV.find(n => route === n.id || route.startsWith(n.id + '/')) ?? NAV[0];
  return (
    <header className="relative z-20 flex h-[60px] flex-shrink-0 items-center justify-between gap-3 border-b border-cc-border bg-cc-bg/80 px-5 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={() => navigate('overview')} className="flex items-center gap-2 md:hidden" aria-label="JalSetu home">
          <Mark className="h-7 w-7 text-cc-accent" /><span className="display text-xl">JalSetu</span>
        </button>
        <div className="hidden min-w-0 items-center gap-2 text-sm md:flex">
          <span className="text-cc-faint">{page.group}</span><span className="text-cc-strong">/</span>
          <AnimatePresence mode="wait">
            <motion.span key={page.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
              className="truncate font-medium text-cc-text">{page.label}</motion.span>
          </AnimatePresence>
        </div>
        {overview && overview.activeEmergencies > 0 && (
          <button onClick={() => navigate('disasters')} className="hidden xl:block"><Chip tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>{overview.activeEmergencies} severe alerts</Chip></button>
        )}
      </div>
      <button onClick={() => setPalette(true)}
        className="group hidden h-9 w-[min(360px,32vw)] items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-3.5 text-sm text-cc-faint shadow-[0_1px_2px_rgb(19_31_42/0.04)] transition hover:border-cc-strong hover:text-cc-muted md:flex">
        <Search className="h-4 w-4" /><span className="flex-1 text-left">Search places, pages, actions</span>
        <kbd className="flex items-center gap-0.5 rounded-md border border-cc-border px-1.5 text-[10px]"><Command className="h-2.5 w-2.5" />K</kbd>
      </button>
      <div className="flex items-center gap-3">
        <span className={cx('hidden items-center gap-1.5 text-xs font-medium sm:flex', wsConnected ? 'text-green-800' : 'text-amber-800')}
          title={wsConnected ? 'Realtime channel connected' : 'Realtime channel reconnecting; polling every 10 s'}>
          {wsConnected
            ? <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-cc-live opacity-50" /><span className="relative h-2 w-2 rounded-full bg-cc-live" /></span>
            : <WifiOff className="h-3.5 w-3.5" />}
          {wsConnected ? 'Live' : 'Reconnecting'}
        </span>
        <span className="hidden h-6 w-px bg-cc-border lg:block" />
        <IstClock />
        <Notifications />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </header>
  );
};

// ---------------------------------------------------------------------------- navigation rail
const HealthLine: React.FC = () => {
  const { health, navigate } = useApp();
  if (!health) return null;
  const degraded = health.sources.filter(s => ['ndma_sachet', 'osrm', 'open_meteo', 'news_crisis', 'rainfall_deficit'].includes(s.key) && s.status === 'degraded').length
    + (health.database.status !== 'healthy' ? 1 : 0) + (health.ml.complaintClassifier !== 'healthy' ? 1 : 0);
  return (
    <button onClick={() => navigate('admin')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-text" title="System health">
      {degraded ? <AlertTriangle className="h-3.5 w-3.5 text-amber-700" /> : <ShieldCheck className="h-3.5 w-3.5 text-green-700" />}
      {degraded ? `${degraded} data source${degraded > 1 ? 's' : ''} degraded` : 'All systems operational'}
    </button>
  );
};

export const NavRail: React.FC = () => {
  const { route, navigate, overview, user, logout } = useApp();
  const badges: Record<string, number | undefined> = {
    verification: overview?.pendingVerifications || undefined,
    disasters: overview?.activeAlerts || undefined,
    requests: overview?.criticalRequests || undefined,
    complaints: overview?.openComplaints || undefined,
  };
  const groups = useMemo(() => [...new Set(NAV.map(n => n.group))], []);
  return (
    <nav aria-label="Primary" className="hidden w-[248px] flex-shrink-0 flex-col border-r border-cc-border bg-cc-raised/70 md:flex">
      <button onClick={() => navigate('overview')} className="flex items-center gap-2.5 px-5 pb-4 pt-5" aria-label="JalSetu home">
        <motion.span whileHover={{ rotate: -8, scale: 1.05 }} transition={SPRING}><Mark className="h-8 w-8 text-cc-accent" /></motion.span>
        <span className="text-left leading-none">
          <span className="display block text-[26px]">JalSetu</span>
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.18em] text-cc-faint">Water operations · MH</span>
        </span>
      </button>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {groups.map(g => (
          <div key={g} className="mb-3">
            <p className="eyebrow px-3 pb-1.5 pt-2">{g}</p>
            {NAV.filter(n => n.group === g).map(n => {
              const Icon = n.icon;
              const active = route === n.id || route.startsWith(n.id + '/') || (n.id === 'overview' && route === '');
              return (
                <button key={n.id} onClick={() => navigate(n.id)} aria-current={active ? 'page' : undefined}
                  className={cx('relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-colors', active ? 'font-medium text-cc-text' : 'text-cc-muted hover:text-cc-text')}>
                  {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-cc-border bg-cc-surface shadow-[0_1px_3px_rgb(19_31_42/0.07)]" transition={SPRING} />}
                  <Icon className={cx('relative h-[17px] w-[17px] flex-shrink-0', active ? 'text-cc-accent' : '')} />
                  <span className="relative flex-1 text-left">{n.label}</span>
                  {badges[n.id] ? <span className="num relative rounded-full bg-cc-danger/10 px-1.5 text-[10.5px] font-semibold text-red-700">{badges[n.id]}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-cc-border p-3">
        <HealthLine />
        <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-cc-surface p-2.5 ring-1 ring-cc-border">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cc-accent/10 text-xs font-semibold text-cc-accent-strong">
            {(user?.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('')}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium">{user?.name}</span>
            <span className="block text-[11px] capitalize text-cc-faint">{user?.role}</span>
          </span>
          <Button variant="ghost" size="sm" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut className="h-4 w-4" /></Button>
        </div>
      </div>
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
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div key={t.id} layout role="status" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
            transition={SPRING}
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-cc-border bg-cc-surface p-3.5 shadow-pop">
            <span className={cx('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
              t.type === 'success' ? 'bg-cc-ok/10 text-green-700' : t.type === 'info' ? 'bg-cc-accent/10 text-cc-accent' : t.type === 'error' ? 'bg-cc-danger/10 text-red-700' : 'bg-cc-warn/10 text-amber-800')}>
              {t.type === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : t.type === 'info' ? <Activity className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t.title}</p>{t.message && <p className="mt-0.5 break-words text-xs text-cc-muted">{t.message}</p>}</div>
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-cc-faint hover:text-cc-text"><X className="h-4 w-4" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export function useTick(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT(x => x + 1), ms); return () => clearInterval(id); }, [ms]);
}
