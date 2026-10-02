import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, setUnauthorizedHandler, tokenStore } from '../services/api';
import type {
  AllocationPlan, Community, Complaint, ComplaintCategory, ComplaintStatus, DashboardStats, DeliveryRecord, Depot,
  NewWaterRequest, OperationsSettings, PriorityWeights, RequestStatus, Tanker, UrgencyLevel, UserProfile, WaterRequest,
} from '../types';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
}

type Slice = 'communities' | 'requests' | 'complaints' | 'tankers' | 'deliveries' | 'plan' | 'settings' | 'dashboard' | 'depots';

interface WaterDataContextType {
  currentUser: UserProfile | null;
  authChecked: boolean;
  activeTab: string;
  communities: Community[];
  requests: WaterRequest[];
  complaints: Complaint[];
  tankers: Tanker[];
  deliveries: DeliveryRecord[];
  depots: Depot[];
  plan: AllocationPlan | null;
  fleetSupply: number;
  weights: PriorityWeights | null;
  operations: OperationsSettings | null;
  dashboard: DashboardStats | null;
  isLoading: boolean;
  isLive: boolean;
  isAllocationRunning: boolean;
  selectedCommunity: Community | null;
  toasts: ToastItem[];

  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setActiveTab: (tab: string) => void;
  setSelectedCommunity: (c: Community | null) => void;
  refresh: (...slices: Slice[]) => Promise<void>;

  createRequest: (r: NewWaterRequest) => Promise<WaterRequest | null>;
  updateRequestStatus: (id: string, status: RequestStatus) => Promise<void>;
  createComplaint: (c: { communityId: string; description: string; reporterName?: string; reporterPhone?: string }) => Promise<Complaint | null>;
  updateComplaint: (id: string, u: { status?: ComplaintStatus; assignedOfficer?: string; category?: ComplaintCategory; severity?: UrgencyLevel; confirmLabels?: boolean }) => Promise<void>;
  runAllocation: (opts?: { totalSupply?: number; useForecast?: boolean }) => Promise<void>;
  approveAllocation: () => Promise<void>;
  reportBreakdown: (tankerId: string, note: string) => Promise<void>;
  restoreTanker: (tankerId: string) => Promise<void>;
  verifyDelivery: (id: string, notes?: string) => Promise<void>;
  investigateDelivery: (id: string, notes?: string) => Promise<void>;
  saveWeights: (w: PriorityWeights) => Promise<void>;
  saveOperations: (o: Partial<OperationsSettings>) => Promise<void>;

  addToast: (title: string, message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;
  handleError: (e: unknown, title?: string) => void;
}

const WaterDataContext = createContext<WaterDataContextType | undefined>(undefined);

const STAFF_SLICES: Slice[] = ['communities', 'requests', 'complaints', 'tankers', 'deliveries', 'plan', 'settings', 'dashboard', 'depots'];

const initialTab = () => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'dashboard';

export const WaterDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTabState] = useState<string>(initialTab);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [requests, setRequests] = useState<WaterRequest[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [tankers, setTankers] = useState<Tanker[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [fleetSupply, setFleetSupply] = useState(0);
  const [weights, setWeights] = useState<PriorityWeights | null>(null);
  const [operations, setOperations] = useState<OperationsSettings | null>(null);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isAllocationRunning, setIsAllocationRunning] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((title: string, message: string, type: ToastItem['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev.slice(-4), { id, title, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);
  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  const handleError = useCallback((e: unknown, title = 'Something went wrong') => {
    addToast(title, e instanceof Error ? e.message : String(e), 'error');
  }, [addToast]);

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    if (window.location.hash.slice(1) !== tab) window.history.replaceState(null, '', `#${tab}`);
  }, []);

  // ---------------------------------------------------------------- loading
  const loaders: Record<Slice, () => Promise<void>> = {
    communities: async () => setCommunities(await api.communities()),
    requests: async () => setRequests(await api.requests()),
    complaints: async () => setComplaints(await api.complaints()),
    tankers: async () => setTankers(await api.tankers()),
    deliveries: async () => setDeliveries(await api.deliveries()),
    depots: async () => setDepots(await api.depots()),
    plan: async () => { const r = await api.currentPlan(); setPlan(r.plan); setFleetSupply(r.fleetSupply); },
    settings: async () => { const s = await api.settings(); setWeights(s.weights); setOperations(s.operations); },
    dashboard: async () => setDashboard(await api.dashboard()),
  };
  const loadersRef = useRef(loaders);
  loadersRef.current = loaders;

  const refresh = useCallback(async (...slices: Slice[]) => {
    const results = await Promise.allSettled(slices.map(s => loadersRef.current[s]()));
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed && !(failed.reason instanceof ApiError && failed.reason.status === 401)) {
      handleError(failed.reason, 'Could not load data');
    }
  }, [handleError]);

  const clearData = () => {
    setCommunities([]); setRequests([]); setComplaints([]); setTankers([]); setDeliveries([]);
    setPlan(null); setDashboard(null); setDepots([]);
  };

  const logout = useCallback(() => {
    tokenStore.set(null);
    setCurrentUser(null);
    clearData();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (tokenStore.get()) addToast('Session expired', 'Please sign in again.', 'warning');
      logout();
    });
  }, [addToast, logout]);

  // Restore session
  useEffect(() => {
    if (!tokenStore.get()) { setAuthChecked(true); return; }
    api.me().then(setCurrentUser).catch(() => tokenStore.set(null)).finally(() => setAuthChecked(true));
  }, []);

  // Initial data load per user
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'driver') { setActiveTab('driver'); return; }
    setIsLoading(true);
    refresh(...STAFF_SLICES).finally(() => setIsLoading(false));
  }, [currentUser, refresh, setActiveTab]);

  // ---------------------------------------------------------------- realtime
  useEffect(() => {
    if (!currentUser || currentUser.role === 'driver') return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const pending = new Set<Slice>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (...s: Slice[]) => {
      s.forEach(x => pending.add(x));
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { const list = [...pending]; pending.clear(); refresh(...list); }, 400);
    };

    const connect = () => {
      ws = new WebSocket(api.wsUrl());
      ws.onopen = () => { setIsLive(true); retry = 1000; keepalive = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000); };
      ws.onclose = () => {
        setIsLive(false);
        clearInterval(keepalive);
        if (!closed) setTimeout(connect, retry = Math.min(retry * 2, 30000));
      };
      ws.onmessage = (msg) => {
        let evt: { event: string; data: any };
        try { evt = JSON.parse(msg.data); } catch { return; }
        switch (evt.event) {
          case 'tanker.position':
            setTankers(prev => prev.map(t => t.id === evt.data.id
              ? { ...t, currentCoordinates: [evt.data.lat, evt.data.lng], speedKmH: Math.round(evt.data.speedKmH || 0), gpsOnline: true, lastPingAt: new Date().toISOString() }
              : t));
            break;
          case 'communities.changed': schedule('communities', 'dashboard'); break;
          case 'requests.changed': schedule('requests', 'communities', 'dashboard'); break;
          case 'complaints.changed':
            schedule('complaints', 'communities', 'dashboard');
            if (evt.data?.severity === 'Critical') addToast('Critical complaint', `${evt.data.id} from ${evt.data.community}`, 'warning');
            break;
          case 'tankers.changed': schedule('tankers', 'dashboard', 'plan'); break;
          case 'deliveries.changed': schedule('deliveries', 'tankers', 'communities', 'dashboard'); break;
          case 'allocation.changed': schedule('plan', 'communities', 'dashboard'); break;
          case 'settings.changed': schedule('settings', 'communities', 'plan'); break;
          case 'ml.retrained': addToast('Models retrained', `New ${evt.data?.target} model is live.`, 'success'); break;
        }
      };
    };
    connect();
    // Telemetry fallback: keep tanker positions fresh even if the socket drops.
    const poll = setInterval(() => { if (!ws || ws.readyState !== 1) refresh('tankers'); }, 15000);
    return () => { closed = true; clearInterval(poll); clearInterval(keepalive); clearTimeout(flushTimer); ws?.close(); };
  }, [currentUser, refresh, addToast]);

  // ---------------------------------------------------------------- actions
  const login = async (email: string, password: string) => {
    const r = await api.login(email, password);
    tokenStore.set(r.accessToken);
    setCurrentUser(r.user);
    if (r.user.role === 'driver') setActiveTab('driver');
    else if (activeTab === 'driver') setActiveTab('dashboard');
  };

  const wrap = async <T,>(fn: () => Promise<T>, errTitle: string): Promise<T | null> => {
    try { return await fn(); } catch (e) { handleError(e, errTitle); return null; }
  };

  const createRequest = (r: NewWaterRequest) => wrap(async () => {
    const created = await api.createRequest(r);
    addToast('Request created', `${created.id} scored ${created.priorityScore}/100 (${created.urgency}).`, 'success');
    await refresh('requests', 'communities', 'dashboard');
    return created;
  }, 'Could not create request');

  const updateRequestStatus = async (id: string, status: RequestStatus) => {
    await wrap(async () => {
      await api.setRequestStatus(id, status);
      addToast('Request updated', `${id} → ${status}`, 'info');
      await refresh('requests', 'communities');
    }, 'Could not update request');
  };

  const createComplaint = (c: { communityId: string; description: string; reporterName?: string; reporterPhone?: string }) => wrap(async () => {
    const created = await api.createComplaint(c);
    addToast('Complaint registered', `${created.id}: ${created.category} · ${created.severity}${created.duplicateOf ? ` · possible duplicate of ${created.duplicateOf}` : ''}`, 'success');
    await refresh('complaints', 'communities', 'dashboard');
    return created;
  }, 'Could not register complaint');

  const updateComplaint = async (id: string, u: Parameters<WaterDataContextType['updateComplaint']>[1]) => {
    await wrap(async () => {
      await api.updateComplaint(id, u);
      addToast('Complaint updated', id, 'success');
      await refresh('complaints', 'communities', 'dashboard');
    }, 'Could not update complaint');
  };

  const runAllocation = async (opts: { totalSupply?: number; useForecast?: boolean } = {}) => {
    setIsAllocationRunning(true);
    await wrap(async () => {
      const p = await api.runAllocation({ useForecast: true, ...opts });
      setPlan(p);
      addToast('Allocation plan ready', `Need-weighted equity ${p.fairnessBefore}% → ${p.fairnessAfter}% across ${p.items.length} communities.`, 'success');
    }, 'Allocation failed');
    setIsAllocationRunning(false);
  };

  const approveAllocation = async () => {
    if (!plan) return;
    await wrap(async () => {
      const r = await api.approvePlan(plan.id);
      setPlan(r);
      addToast('Allocation approved', `Quotas applied; ${r.requestsAllocated} pending requests marked Allocated.`, 'success');
      await refresh('communities', 'requests', 'dashboard');
    }, 'Could not approve plan');
  };

  const reportBreakdown = async (tankerId: string, note: string) => {
    await wrap(async () => {
      const r = await api.breakdown(tankerId, note);
      if (r.plan) setPlan(r.plan);
      addToast('Disruption re-plan', `${tankerId} out of service. Allocation recomputed with protected communities held.`, 'warning');
      await refresh('tankers', 'dashboard');
    }, 'Could not report breakdown');
  };

  const restoreTanker = async (tankerId: string) => {
    await wrap(async () => {
      await api.restoreTanker(tankerId);
      addToast('Tanker restored', `${tankerId} is back in service. Re-run allocation to use its capacity.`, 'success');
      await refresh('tankers', 'plan', 'dashboard');
    }, 'Could not restore tanker');
  };

  const verifyDelivery = async (id: string, notes = '') => {
    await wrap(async () => {
      await api.verifyDelivery(id, notes);
      addToast('Delivery verified', id, 'success');
      await refresh('deliveries', 'dashboard');
    }, 'Could not verify delivery');
  };

  const investigateDelivery = async (id: string, notes = '') => {
    await wrap(async () => {
      await api.investigateDelivery(id, notes);
      addToast('Investigation opened', id, 'warning');
      await refresh('deliveries', 'dashboard');
    }, 'Could not open investigation');
  };

  const saveWeights = async (w: PriorityWeights) => {
    await wrap(async () => {
      setWeights(await api.saveWeights(w));
      addToast('Weights saved', 'Priority scores recalculated. Re-run allocation to apply them to a plan.', 'success');
      await refresh('communities');
    }, 'Could not save weights');
  };

  const saveOperations = async (o: Partial<OperationsSettings>) => {
    await wrap(async () => {
      setOperations(await api.saveOperations(o));
      addToast('Settings saved', 'Operational parameters updated.', 'success');
      await refresh('plan');
    }, 'Could not save settings');
  };

  return (
    <WaterDataContext.Provider value={{
      currentUser, authChecked, activeTab, communities, requests, complaints, tankers, deliveries, depots, plan, fleetSupply,
      weights, operations, dashboard, isLoading, isLive, isAllocationRunning, selectedCommunity, toasts,
      login, logout, setActiveTab, setSelectedCommunity, refresh,
      createRequest, updateRequestStatus, createComplaint, updateComplaint, runAllocation, approveAllocation,
      reportBreakdown, restoreTanker, verifyDelivery, investigateDelivery, saveWeights, saveOperations,
      addToast, removeToast, handleError,
    }}>
      {children}
    </WaterDataContext.Provider>
  );
};

export const useWaterData = () => {
  const ctx = useContext(WaterDataContext);
  if (!ctx) throw new Error('useWaterData must be used within a WaterDataProvider');
  return ctx;
};
