import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Building2, CalendarClock, CaretLeft, CheckCircle2, ClipboardCheck, Command, Cpu, Droplets,
  FileSpreadsheet, LayoutDashboard, ListBullets, LogOut, MessageSquareWarning, Monitor, Moon, Radio, RadioTower, Route, Scale, Search, Settings2,
  ShieldCheck, Sparkles, Sun, Truck, WifiOff, X,
} from '../icons';
import { useApp, useNow } from '../../context/AppContext';
import { api } from '../../services/api';
import { Button, Chip, cx, formatAge, ProvMark, Segmented } from '../ui';
import { DUR, EASE_OUT, SPRING, SPRING_SHEET } from '../../motion';
import { useTheme, type ThemeChoice } from '../../theme';

export const NAV: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string; group: string; hint?: string }[] = [
  { id: 'overview', label: 'Command centre', icon: LayoutDashboard, group: 'Operations', hint: 'State map, crisis signals, situation' },
  { id: 'live', label: 'Live operations', icon: Radio, group: 'Operations', hint: 'Vehicles on the road, real GPS' },
  { id: 'trips', label: 'Trips & dispatch', icon: Route, group: 'Operations', hint: 'Auto-dispatch proposals, trip records' },
  { id: 'verification', label: 'Verification', icon: ClipboardCheck, group: 'Operations', hint: 'Proof of delivery sign-off' },
  { id: 'fleet', label: 'Fleet', icon: Truck, group: 'Operations' },
  { id: 'disasters', label: 'Disaster alerts', icon: RadioTower, group: 'Intelligence', hint: 'Official NDMA alerts' },
  { id: 'requests', label: 'Water requests', icon: Droplets, group: 'Demand' },
  { id: 'allocation', label: 'Allocation', icon: Cpu, group: 'Demand', hint: 'Fair-share optimiser' },
  { id: 'communities', label: 'Communities', icon: Building2, group: 'Demand' },
  { id: 'schedules', label: 'Tap schedules', icon: CalendarClock, group: 'Demand', hint: 'Public tap timings + supply notices' },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning, group: 'Demand' },
  { id: 'impact', label: 'Impact', icon: Scale, group: 'Insight', hint: 'First come first served vs JalSetu' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Insight' },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet, group: 'Insight' },
  { id: 'admin', label: 'Administration', icon: Settings2, group: 'System' },
];

/** The JalSetu mark: a drop whose lower half is a bridge arch ("jal" water + "setu" bridge). */
export const Mark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden>
    <path d="M16 3.5c-4.6 6-8.5 10.6-8.5 15.2A8.5 8.5 0 0 0 16 27.2a8.5 8.5 0 0 0 8.5-8.5C24.5 14.1 20.6 9.5 16 3.5Z" fill="currentColor" />
    <path d="M9.6 21.2c1.8-3 4-4.4 6.4-4.4s4.6 1.4 6.4 4.4" fill="none" stroke="rgb(var(--cc-surface))" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12.3 19.2v3.1M16 16.8v4.6M19.7 19.2v3.1" stroke="rgb(var(--cc-surface))" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const IstClock: React.FC = () => {
  const { serverOffsetMs } = useApp();
  const now = useNow(serverOffsetMs);
  const d = new Date(now);
  return (
    <div className="hidden text-right leading-tight lg:block" title="Server-aligned time, India Standard Time">
      <p className="mono text-[13px] font-medium text-cc-text">{d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}</p>
      <p className="text-[10.5px] text-cc-faint">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} IST</p>
    </div>
  );
};

// ---------------------------------------------------------------------------- notifications
const Notifications: React.FC = () => {
  const { notifications, refresh, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const now = Date.now();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  const markAll = async () => { await api.markRead().catch(() => undefined); refresh('notifications'); };
  const go = (entity: string) => {
    setOpen(false);
    navigate({ trip: 'trips', vehicle: 'live', disaster: 'disasters', delivery: 'verification', crisis_signal: 'overview' }[entity] || 'overview');
  };
  return (
    <div className="relative" ref={box}>
      <button aria-label={`Notifications, ${notifications.unread} unread`} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-text">
        <motion.span key={notifications.unread} initial={{ rotate: notifications.unread ? -14 : 0 }} animate={{ rotate: 0 }} transition={SPRING}><Bell className="h-[18px] w-[18px]" /></motion.span>
        <AnimatePresence>
          {notifications.unread > 0 && (
            <motion.span key="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}
              className="mono absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-cc-danger px-1 text-center text-[10px] font-semibold leading-[17px] text-white ring-2 ring-cc-bg">
              {notifications.unread > 99 ? '99+' : notifications.unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: DUR.quick, ease: EASE_OUT }} style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-palette mt-2 w-[min(400px,calc(100vw-1.5rem))] overflow-hidden rounded-card border border-cc-border bg-cc-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-cc-border px-4 py-3">
              <p className="text-[14px] font-semibold">Notifications</p>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>
                <Button size="sm" variant="ghost" aria-label="Close" className="!w-8 !px-0" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></Button></div>
            </div>
            <ul className="max-h-[60vh] divide-y divide-cc-border overflow-y-auto">
              {notifications.items.length === 0 && <li className="p-6 text-center text-sm text-cc-muted">Nothing new.</li>}
              {notifications.items.map((n, i) => (
                <motion.li key={n.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.02, duration: DUR.quick }}>
                  <button onClick={() => go(n.entity)} className={cx('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-cc-hover/60', !n.read && 'bg-cc-accent/[0.04]')}>
                    <span className={cx('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', n.severity === 'critical' ? 'bg-cc-danger' : n.severity === 'warning' ? 'bg-cc-warn' : 'bg-cc-accent', n.read && 'opacity-30')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-[12px] text-cc-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-cc-faint">{n.severity !== 'info' && <span className="font-medium capitalize">{n.severity} · </span>}{formatAge((now - Date.parse(n.createdAt)) / 1000)} ago{!n.read && <span className="sr-only">, unread</span>}</span>
                    </span>
                  </button>
                </motion.li>
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
  const { setTheme } = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  const items: Cmd[] = useMemo(() => {
    const go = (r: string) => () => { navigate(r); onClose(); };
    const base: Cmd[] = NAV.map(n => ({ id: `nav-${n.id}`, label: n.label, hint: n.hint, icon: n.icon, run: go(n.id), group: 'Go to' }));
    if (can('dispatch')) base.push({ id: 'act-plan', label: 'Plan trips now', hint: 'Generate auto-dispatch proposals', icon: Sparkles, group: 'Actions',
      run: async () => { onClose(); try { const r = await api.propose(); toast('Proposals ready', `${r.proposed} trip(s) proposed`, 'success'); refresh('proposals'); navigate('trips'); } catch (e) { toast('Could not plan', String(e), 'error'); } } });
    if (can('run_ingestion')) base.push({ id: 'act-signals', label: 'Refresh crisis signals', hint: 'Pull news and rainfall now', icon: Activity, group: 'Actions',
      run: async () => { onClose(); toast('Refreshing signals', 'This can take up to a minute.', 'info'); try { const r = await api.refreshCrisis(); toast('Signals refreshed', `${r.inCrisis} communities in crisis`, 'success'); refresh('signals', 'communities'); } catch (e) { toast('Refresh failed', String(e), 'error'); } } });
    base.push({ id: 'theme-dark', label: 'Dark theme', icon: Moon, group: 'Appearance', run: () => { setTheme('dark'); onClose(); } },
      { id: 'theme-light', label: 'Light theme', icon: Sun, group: 'Appearance', run: () => { setTheme('light'); onClose(); } },
      { id: 'theme-auto', label: 'Match system theme', icon: Monitor, group: 'Appearance', run: () => { setTheme('auto'); onClose(); } });
    const needle = q.trim().toLowerCase();
    const places: Cmd[] = needle.length >= 2 ? communities.filter(c => c.name.toLowerCase().includes(needle)).slice(0, 8).map(c => ({
      id: `c-${c.id}`, label: c.name, hint: `${c.districtName ?? ''} · ${c.population.toLocaleString('en-IN')} people · ${c.status}`, icon: Building2, group: 'Places',
      run: () => { navigate(`overview/${c.id}`); onClose(); },
    })) : [];
    const filtered = base.filter(i => !needle || i.label.toLowerCase().includes(needle) || i.hint?.toLowerCase().includes(needle));
    return [...filtered.filter(i => needle || i.group !== 'Appearance'), ...places];
  }, [q, communities, navigate, onClose, can, toast, refresh, setTheme]);

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
        <div className="fixed inset-0 z-palette flex items-start justify-center p-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.button aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-cc-sunken/50 backdrop-blur-[3px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={SPRING_SHEET}
            className="relative w-full max-w-xl overflow-hidden rounded-card border border-cc-border bg-cc-surface shadow-pop">
            <div className="flex items-center gap-3 border-b border-cc-border px-4">
              <Search className="h-4 w-4 text-cc-faint" />
              <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={key} placeholder="Search pages, actions or any town or village"
                aria-label="Search pages, actions or places" role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={items[sel] ? `cmd-${items[sel].id}` : undefined}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-cc-faint" />
              <kbd className="rounded-md border border-cc-border px-1.5 py-0.5 text-[10px] text-cc-faint">Esc</kbd>
            </div>
            <ul id="cmd-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && <li className="p-6 text-center text-sm text-cc-muted">No matches for “{q}”.</li>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
                const Icon = it.icon;
                return (
                  <React.Fragment key={it.id}>
                    {header && <li role="presentation" className="px-3 pb-1 pt-3 text-[11px] font-medium text-cc-faint">{header}</li>}
                    <li id={`cmd-${it.id}`} role="option" aria-selected={sel === i}>
                      <button onMouseEnter={() => setSel(i)} onClick={it.run} tabIndex={-1}
                        className={cx('relative flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left', sel === i ? 'text-cc-text' : 'text-cc-muted')}>
                        {sel === i && <motion.span layoutId="cmd-sel" className="absolute inset-0 rounded-control bg-cc-hover" transition={SPRING} />}
                        <Icon className="relative h-4 w-4 flex-shrink-0" />
                        <span className="relative min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-cc-text">{it.label}</span>
                          {it.hint && <span className="block truncate text-[12px] text-cc-muted">{it.hint}</span>}
                        </span>
                        {sel === i && <ArrowRight className="relative h-4 w-4 text-cc-faint" />}
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-cc-border bg-cc-raised px-4 py-2 text-[11px] text-cc-faint">
              <span><kbd className="font-sans">↑↓</kbd> move</span><span><kbd className="font-sans">↵</kbd> open</span><span className="ml-auto">Try a village name</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------- top bar
export const TopBar: React.FC<{ onMenu?: () => void }> = ({ onMenu }) => {
  const { route, wsConnected, overview, navigate } = useApp();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const page = NAV.find(n => route === n.id || route.startsWith(n.id + '/')) ?? NAV[0];
  return (
    <header className="relative z-sticky flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-cc-border bg-cc-bg/85 px-3 backdrop-blur-xl md:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button onClick={onMenu} className="flex h-9 w-9 items-center justify-center rounded-control text-cc-muted hover:bg-cc-hover md:hidden" aria-label="Open navigation">
          <ListBullets className="h-5 w-5" />
        </button>
        <button onClick={() => navigate('overview')} className="flex items-center gap-2 md:hidden" aria-label="JalSetu home">
          <Mark className="h-6 w-6 text-cc-accent" /><span className="display text-[17px]">JalSetu</span>
        </button>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] md:flex">
          <span className="text-cc-faint">{page.group}</span><span className="text-cc-strong" aria-hidden>/</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={page.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: DUR.quick, ease: EASE_OUT }}
              aria-current="page" className="truncate font-medium text-cc-text">{page.label}</motion.span>
          </AnimatePresence>
        </nav>
        <AnimatePresence>
          {overview && overview.activeEmergencies > 0 && (
            <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING}
              onClick={() => navigate('disasters')} className="hidden xl:block">
              <Chip tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{overview.activeEmergencies} severe official alerts</Chip>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <button onClick={() => setPalette(true)} aria-label="Search places, pages and actions (Ctrl K)"
        className="group hidden h-9 w-[min(380px,32vw)] items-center gap-2 rounded-control border border-cc-border bg-cc-surface px-3 text-[13px] text-cc-faint transition-colors hover:border-cc-strong hover:text-cc-muted md:flex">
        <Search className="h-4 w-4" /><span className="flex-1 text-left">Search places, pages, actions</span>
        <kbd className="flex items-center gap-0.5 rounded-md border border-cc-border px-1.5 text-[10px]"><Command className="h-2.5 w-2.5" />K</kbd>
      </button>
      <div className="flex items-center gap-2 md:gap-3">
        <button onClick={() => setPalette(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-cc-muted hover:bg-cc-hover md:hidden" aria-label="Search">
          <Search className="h-[18px] w-[18px]" />
        </button>
        <span role="status" className={cx('hidden items-center gap-1.5 text-[12px] font-medium sm:flex', wsConnected ? 'text-green-800' : 'text-amber-800')}
          title={wsConnected ? 'Realtime channel connected' : 'Realtime channel reconnecting; data refreshes every 10 s meanwhile'}>
          {wsConnected ? <ProvMark kind="live" /> : <WifiOff className="h-3.5 w-3.5" />}
          {wsConnected ? 'Realtime' : 'Reconnecting'}
        </span>
        <span className="hidden h-6 w-px bg-cc-border lg:block" />
        <IstClock />
        <Notifications />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </header>
  );
};

// ---------------------------------------------------------------------------- navigation
const HealthLine: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => {
  const { health, navigate } = useApp();
  if (!health) return null;
  const degraded = health.sources.filter(s => ['ndma_sachet', 'osrm', 'open_meteo', 'news_crisis', 'rainfall_deficit'].includes(s.key) && s.status === 'degraded').length
    + (health.database.status !== 'healthy' ? 1 : 0) + (health.ml.complaintClassifier !== 'healthy' ? 1 : 0);
  const label = degraded ? `${degraded} data source${degraded > 1 ? 's' : ''} degraded` : 'All systems operational';
  return (
    <button onClick={() => navigate('admin')} title={label} aria-label={`System health: ${label}`}
      className={cx('flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-text', collapsed && 'justify-center')}>
      {degraded ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-700" /> : <ShieldCheck className="h-4 w-4 flex-shrink-0 text-green-700" />}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
};

const ThemeSwitch: React.FC = () => {
  const { choice, setTheme } = useTheme();
  return (
    <Segmented label="Theme" value={choice} onChange={id => setTheme(id as ThemeChoice)} className="w-full [&>button]:flex-1"
      options={[{ id: 'light', label: <Sun className="mx-auto h-3.5 w-3.5" aria-label="Light" /> }, { id: 'auto', label: <Monitor className="mx-auto h-3.5 w-3.5" aria-label="System" /> },
        { id: 'dark', label: <Moon className="mx-auto h-3.5 w-3.5" aria-label="Dark" /> }]} />
  );
};

const NavList: React.FC<{ collapsed: boolean; onPick?: () => void }> = ({ collapsed, onPick }) => {
  const { route, navigate, overview } = useApp();
  const badges: Record<string, number | undefined> = {
    verification: overview?.pendingVerifications || undefined,
    disasters: overview?.activeEmergencies || undefined,
    requests: overview?.criticalRequests || undefined,
    complaints: overview?.openComplaints || undefined,
  };
  const groups = useMemo(() => [...new Set(NAV.map(n => n.group))], []);
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3">
      {groups.map(g => (
        <div key={g} className="mb-2">
          {collapsed ? <div className="mx-3 my-2.5 h-px bg-cc-border" /> : <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-cc-faint">{g}</p>}
          {NAV.filter(n => n.group === g).map(n => {
            const Icon = n.icon;
            const active = route === n.id || route.startsWith(n.id + '/') || (n.id === 'overview' && route === '');
            return (
              <button key={n.id} onClick={() => { navigate(n.id); onPick?.(); }} aria-current={active ? 'page' : undefined} title={collapsed ? n.label : undefined}
                className={cx('group relative flex h-9 w-full items-center gap-3 rounded-control px-3 text-[13.5px] transition-colors duration-150',
                  active ? 'font-medium text-cc-text' : 'text-cc-muted hover:bg-cc-hover/70 hover:text-cc-text', collapsed && 'justify-center px-0')}>
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-control bg-cc-surface shadow-[0_1px_2px_rgb(var(--cc-shadow)/0.1),inset_0_0_0_1px_rgb(var(--cc-border))]" transition={SPRING} />}
                {active && <motion.span layoutId="nav-bar" className="absolute -left-2.5 top-2 h-5 w-[3px] rounded-r-full bg-cc-accent" transition={SPRING} />}
                <Icon className={cx('relative h-[18px] w-[18px] flex-shrink-0 transition-colors', active ? 'text-cc-accent' : 'group-hover:text-cc-text')} />
                {!collapsed && <span className="relative flex-1 truncate text-left">{n.label}</span>}
                {badges[n.id] ? (
                  <span className={cx('mono relative rounded-full bg-cc-danger/10 px-1.5 text-[10.5px] font-semibold text-red-700', collapsed && 'absolute right-1 top-0.5 px-1 text-[9px]')}>
                    {badges[n.id]}<span className="sr-only"> needing attention</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const UserCard: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { user, logout } = useApp();
  const initials = (user?.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('');
  if (collapsed) return (
    <div className="flex flex-col items-center gap-2">
      <span title={`${user?.name} (${user?.role})`} className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-cc-accent/10 text-[11px] font-semibold text-cc-accent-strong">{initials}</span>
      <Button variant="ghost" size="sm" aria-label="Sign out" title="Sign out" className="!w-8 !px-0" onClick={logout}><LogOut className="h-4 w-4" /></Button>
    </div>
  );
  return (
    <div className="space-y-2">
      <ThemeSwitch />
      <div className="flex items-center gap-2.5 rounded-control bg-cc-surface p-2 ring-1 ring-cc-border">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] bg-cc-accent/10 text-[11px] font-semibold text-cc-accent-strong">{initials}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium">{user?.name}</span>
          <span className="block text-[11px] capitalize text-cc-faint">{user?.role}</span>
        </span>
        <Button variant="ghost" size="sm" aria-label="Sign out" title="Sign out" className="!w-8 !px-0" onClick={logout}><LogOut className="h-4 w-4" /></Button>
      </div>
    </div>
  );
};

const RAIL_KEY = 'jalsetu_nav_collapsed';
export const NavRail: React.FC = () => {
  const { navigate } = useApp();
  const [stored, setStored] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } });
  // Laptops and tablets start on the icon rail so content keeps its width; expanding there lasts for the session only.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1439px)').matches);
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1439px)');
    const on = () => { setNarrow(mq.matches); setNarrowOpen(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const collapsed = narrow ? !narrowOpen : stored;
  const toggle = () => {
    if (narrow) { setNarrowOpen(o => !o); return; }
    setStored(c => { try { localStorage.setItem(RAIL_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  };
  return (
    <motion.nav aria-label="Primary" initial={false} animate={{ width: collapsed ? 64 : 232 }} transition={SPRING_SHEET}
      className="relative hidden flex-shrink-0 flex-col border-r border-cc-border bg-cc-raised/60 md:flex">
      <div className={cx('flex items-center gap-2.5 pb-3 pt-4', collapsed ? 'justify-center px-0' : 'px-4')}>
        <button onClick={() => navigate('overview')} className="flex items-center gap-2.5" aria-label="JalSetu home">
          <motion.span whileHover={{ rotate: -8 }} transition={SPRING}><Mark className="h-8 w-8 text-cc-accent" /></motion.span>
          {!collapsed && (
            <span className="text-left leading-none">
              <span className="display block text-[19px]">JalSetu</span>
              <span className="mt-1 block text-[10.5px] text-cc-faint">Water operations · Maharashtra</span>
            </span>
          )}
        </button>
      </div>
      <button onClick={toggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed}
        className="absolute -right-3 top-6 z-overlay flex h-6 w-6 items-center justify-center rounded-full border border-cc-border bg-cc-surface text-cc-muted shadow-panel transition-colors hover:text-cc-text">
        <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={SPRING}><CaretLeft className="h-3 w-3" /></motion.span>
      </button>
      <NavList collapsed={collapsed} />
      <div className={cx('border-t border-cc-border', collapsed ? 'p-2' : 'p-3')}>
        <HealthLine collapsed={collapsed} />
        <div className="mt-2"><UserCard collapsed={collapsed} /></div>
      </div>
    </motion.nav>
  );
};

/** Phones and small tablets: the same navigation in a sheet from the left edge. */
export const MobileNav: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-drawer md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <motion.button aria-label="Close navigation" tabIndex={-1} className="absolute inset-0 bg-cc-sunken/50 backdrop-blur-[2px]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="relative flex h-full w-[min(300px,86vw)] flex-col border-r border-cc-border bg-cc-bg shadow-pop"
            initial={reduce ? { opacity: 0 } : { x: '-100%' }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x: '-100%' }} transition={SPRING_SHEET}>
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <span className="flex items-center gap-2"><Mark className="h-7 w-7 text-cc-accent" /><span className="display text-[18px]">JalSetu</span></span>
              <Button variant="ghost" size="sm" aria-label="Close navigation" className="!w-9 !px-0" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>
            <NavList collapsed={false} onPick={onClose} />
            <div className="border-t border-cc-border p-3"><HealthLine /><div className="mt-2"><UserCard collapsed={false} /></div></div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const Toasts: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div key={t.id} layout role={t.type === 'error' ? 'alert' : 'status'} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 48, transition: { duration: DUR.quick } }} transition={SPRING}
            className="pointer-events-auto flex items-start gap-3 rounded-card border border-cc-border bg-cc-surface p-3.5 shadow-pop">
            <span className={cx('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
              t.type === 'success' ? 'bg-cc-ok/10 text-green-700' : t.type === 'info' ? 'bg-cc-accent/10 text-cc-accent' : t.type === 'error' ? 'bg-cc-danger/10 text-red-700' : 'bg-cc-warn/10 text-amber-800')}>
              {t.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : t.type === 'info' ? <Activity className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1"><p className="text-[13.5px] font-medium">{t.title}</p>{t.message && <p className="mt-0.5 break-words text-[12.5px] text-cc-muted">{t.message}</p>}</div>
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-cc-faint transition-colors hover:text-cc-text"><X className="h-4 w-4" /></button>
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
