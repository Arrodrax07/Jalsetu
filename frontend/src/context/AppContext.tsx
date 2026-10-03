import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, refreshSession, session, setSessionLostHandler } from '../services/api';
import type {
  AllocationPlan, Anomaly, Community, Complaint, CrisisSignal, DeliveryRecord, Depot, DisasterEvent, DispatchProposal, Notification, OperationsSettings, Overview,
  PriorityWeights, SystemHealth, TrackingState, Trip, UserProfile, Vehicle, WaterRequest,
} from '../types';

export interface Toast { id: string; title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }
type Slice = 'overview' | 'vehicles' | 'trips' | 'disasters' | 'notifications' | 'anomalies' | 'health' | 'communities' | 'depots'
  | 'requests' | 'complaints' | 'deliveries' | 'plan' | 'settings' | 'drivers' | 'signals' | 'proposals';

interface Ctx {
  user: UserProfile | null;
  authChecked: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  setUser: (u: UserProfile) => void;
  can: (permission: string) => boolean;

  route: string;
  navigate: (route: string) => void;

  // live data
  overview: Overview | null;
  vehicles: Vehicle[];
  thresholds: { liveSeconds: number; offlineSeconds: number };
  trips: Trip[];
  disasters: DisasterEvent[];
  notifications: { unread: number; items: Notification[] };
  anomalies: Anomaly[];
  health: SystemHealth | null;
  communities: Community[];
  depots: Depot[];
  signals: CrisisSignal[];
  proposals: DispatchProposal[];
  requests: WaterRequest[];
  complaints: Complaint[];
  deliveries: DeliveryRecord[];
  plan: AllocationPlan | null;
  fleetSupply: number;
  weights: PriorityWeights | null;
  operations: OperationsSettings | null;
  drivers: UserProfile[];
  loaded: Set<Slice>;
  wsConnected: boolean;
  serverOffsetMs: number;
  refresh: (...s: Slice[]) => Promise<void>;

  toasts: Toast[];
  toast: (title: string, message: string, type?: Toast['type']) => void;
  dismissToast: (id: string) => void;
  fail: (e: unknown, title?: string) => void;
}

const AppContext = createContext<Ctx | undefined>(undefined);

/** Ticking clock (ms, server-aligned). Components using it re-render once per second. */
export function useNow(offsetMs = 0, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetMs), intervalMs);
    return () => clearInterval(id);
  }, [offsetMs, intervalMs]);
  return now;
}

/** Mirrors backend services.tracking.tracking_state: uses the OLDER of device fix time and receipt time. */
export function liveState(v: Vehicle, th: { liveSeconds: number; offlineSeconds: number }, nowMs: number): { state: TrackingState; age: number | null } {
  if (!v.position || !v.position.receivedAt) return { state: 'no_signal', age: null };
  const rec = Date.parse(v.position.receivedAt);
  const dev = v.position.deviceTime ? Date.parse(v.position.deviceTime) : rec;
  const age = Math.max(0, (nowMs - Math.min(rec, dev)) / 1000);
  return { state: age <= th.liveSeconds ? 'live' : age <= th.offlineSeconds ? 'stale' : 'offline', age };
}

const routeFromHash = () => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'overview';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState(routeFromHash);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [thresholds, setThresholds] = useState({ liveSeconds: 30, offlineSeconds: 180 });
  const [trips, setTrips] = useState<Trip[]>([]);
  const [disasters, setDisasters] = useState<DisasterEvent[]>([]);
  const [notifications, setNotifications] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [signals, setSignals] = useState<CrisisSignal[]>([]);
  const [proposals, setProposals] = useState<DispatchProposal[]>([]);
  const [requests, setRequests] = useState<WaterRequest[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [fleetSupply, setFleetSupply] = useState(0);
  const [weights, setWeights] = useState<PriorityWeights | null>(null);
  const [operations, setOperations] = useState<OperationsSettings | null>(null);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [loaded, setLoaded] = useState<Set<Slice>>(new Set());
  const [wsConnected, setWsConnected] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((title: string, message: string, type: Toast['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts(t => [...t.slice(-3), { id, title, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 8000 : 5000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), []);
  const fail = useCallback((e: unknown, title = 'Action failed') => toast(title, e instanceof Error ? e.message : String(e), 'error'), [toast]);

  const navigate = useCallback((r: string) => {
    setRoute(r);
    if (window.location.hash.slice(1) !== r) window.history.pushState(null, '', `#${r}`);
  }, []);
  useEffect(() => {
    const h = () => setRoute(routeFromHash());
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, []);

  const syncClock = (serverTime?: string) => { if (serverTime) setServerOffsetMs(Date.parse(serverTime) - Date.now()); };

  const loaders: Record<Slice, () => Promise<void>> = {
    overview: async () => { const o = await api.overview(); setOverview(o); syncClock(o.serverTime); },
    vehicles: async () => { const r = await api.vehicles(); setVehicles(r.vehicles); setThresholds(r.thresholds); syncClock(r.serverTime); },
    trips: async () => setTrips(await api.trips()),
    disasters: async () => setDisasters(await api.disasters()),
    notifications: async () => setNotifications(await api.notifications()),
    anomalies: async () => setAnomalies(await api.anomalies()),
    health: async () => setHealth(await api.health()),
    communities: async () => setCommunities(await api.communities()),
    depots: async () => setDepots(await api.depots()),
    signals: async () => setSignals(await api.crisisSignals()),
    proposals: async () => setProposals(await api.proposals()),
    requests: async () => setRequests(await api.requests()),
    complaints: async () => setComplaints(await api.complaints()),
    deliveries: async () => setDeliveries(await api.deliveries()),
    plan: async () => { const r = await api.currentPlan(); setPlan(r.plan); setFleetSupply(r.fleetSupply); },
    settings: async () => { const s = await api.settings(); setWeights(s.weights); setOperations(s.operations); },
    drivers: async () => setDrivers(await api.users('driver')),
  };
  const loadersRef = useRef(loaders);
  loadersRef.current = loaders;

  const refresh = useCallback(async (...slices: Slice[]) => {
    const res = await Promise.allSettled(slices.map(s => loadersRef.current[s]().then(() => s)));
    setLoaded(prev => {
      const n = new Set(prev);
      res.forEach(r => r.status === 'fulfilled' && n.add(r.value));
      return n;
    });
    const bad = res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (bad && !(bad.reason instanceof ApiError && (bad.reason.status === 401 || bad.reason.status === 403))) fail(bad.reason, 'Could not load data');
  }, [fail]);

  const clear = () => {
    setOverview(null); setVehicles([]); setTrips([]); setDisasters([]); setNotifications({ unread: 0, items: [] }); setAnomalies([]);
    setHealth(null); setCommunities([]); setDepots([]); setSignals([]); setProposals([]); setRequests([]); setComplaints([]); setDeliveries([]); setPlan(null); setLoaded(new Set());
  };

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    session.set(null);
    setUserState(null);
    clear();
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      if (session.token) toast('Session ended', 'Please sign in again.', 'warning');
      session.set(null);
      setUserState(null);
      clear();
    });
  }, [toast]);

  // Restore session from the httpOnly refresh cookie.
  useEffect(() => {
    refreshSession().then(s => { if (s) setUserState(s.user); }).finally(() => setAuthChecked(true));
  }, []);

  const login = async (email: string, password: string) => {
    const s = await api.login(email, password);
    setUserState(s.user);
    return s.user;
  };

  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);
  const isStaff = !!user && user.role !== 'driver' && !user.mustChangePassword;

  // Initial load for staff
  useEffect(() => {
    if (!isStaff) return;
    refresh('overview', 'vehicles', 'trips', 'disasters', 'notifications', 'anomalies', 'health', 'communities', 'depots',
      'requests', 'complaints', 'deliveries', 'plan', 'settings', 'drivers');
  }, [isStaff, refresh]);

  // Realtime
  useEffect(() => {
    if (!isStaff) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const pending = new Set<Slice>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (...s: Slice[]) => {
      s.forEach(x => pending.add(x));
      clearTimeout(timer);
      timer = setTimeout(() => { const l = [...pending]; pending.clear(); refresh(...l); }, 300);
    };
    const connect = async () => {
      if (!session.token) await refreshSession();
      ws = new WebSocket(api.wsUrl());
      ws.onopen = () => { setWsConnected(true); retry = 1000; keepalive = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000); schedule('vehicles', 'overview'); };
      ws.onclose = () => {
        setWsConnected(false);
        clearInterval(keepalive);
        if (!closed) setTimeout(() => { refreshSession().finally(connect); }, retry = Math.min(retry * 2, 30000));
      };
      ws.onmessage = (m) => {
        let evt: { event: string; data: any };
        try { evt = JSON.parse(m.data); } catch { return; }
        switch (evt.event) {
          case 'vehicle.update': {
            const v = evt.data as Vehicle;
            setVehicles(prev => {
              const i = prev.findIndex(x => x.vehicleId === v.vehicleId);
              if (i < 0) return [...prev, v];
              const next = prev.slice();
              next[i] = { ...prev[i], ...v };
              return next;
            });
            break;
          }
          case 'trip.changed': schedule('trips', 'overview', 'vehicles', 'requests'); break;
          case 'tankers.changed': schedule('vehicles', 'overview'); break;
          case 'disasters.changed': schedule('disasters', 'overview'); break;
          case 'notification':
            setNotifications(n => ({ unread: n.unread + 1, items: [{ ...evt.data, createdAt: new Date().toISOString(), read: false }, ...n.items].slice(0, 80) }));
            if (evt.data?.severity !== 'info') toast(evt.data.title, evt.data.body || '', evt.data.severity === 'critical' ? 'error' : 'warning');
            if (['route_deviation', 'gps_jump', 'vehicle_offline', 'prolonged_stop'].includes(evt.data?.kind)) schedule('anomalies', 'overview');
            break;
          case 'anomalies.changed': schedule('anomalies', 'overview'); break;
          case 'deliveries.changed': schedule('deliveries', 'overview'); break;
          case 'requests.changed': schedule('requests', 'overview', 'communities'); break;
          case 'complaints.changed': schedule('complaints', 'overview'); break;
          case 'allocation.changed': schedule('plan', 'communities'); break;
          case 'communities.changed': schedule('communities'); break;
          case 'crisis.changed': schedule('signals', 'communities'); break;
          case 'dispatch.changed': schedule('proposals', 'trips', 'vehicles'); break;
          case 'settings.changed': schedule('settings', 'communities'); break;
          case 'ml.retrained': toast('Models retrained', `New ${evt.data?.target} model is live.`, 'success'); break;
        }
      };
    };
    connect();
    // Fallback polling only while the socket is down (no data is ever synthesised client-side).
    const poll = setInterval(() => { if (!ws || ws.readyState !== 1) refresh('vehicles', 'overview'); }, 10000);
    const slow = setInterval(() => refresh('health', 'overview'), 60000);
    return () => { closed = true; clearInterval(poll); clearInterval(slow); clearInterval(keepalive); clearTimeout(timer); ws?.close(); };
  }, [isStaff, refresh, toast]);

  const value = useMemo<Ctx>(() => ({
    user, authChecked, login, logout, setUser: setUserState, can, route, navigate,
    overview, vehicles, thresholds, trips, disasters, notifications, anomalies, health, communities, depots, signals, proposals, requests, complaints, deliveries,
    plan, fleetSupply, weights, operations, drivers, loaded, wsConnected, serverOffsetMs, refresh, toasts, toast, dismissToast, fail,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, authChecked, can, route, navigate, overview, vehicles, thresholds, trips, disasters, notifications, anomalies, health, communities,
    depots, signals, proposals, requests, complaints, deliveries, plan, fleetSupply, weights, operations, drivers, loaded, wsConnected, serverOffsetMs, refresh, toasts,
    toast, dismissToast, fail, logout]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp must be used within AppProvider');
  return c;
};
