/**
 * JalSetu API client.
 * - Access token lives in memory only; the session persists via an httpOnly refresh cookie (path /api/auth).
 * - Any 401 triggers one refresh + retry (single-flight).
 * - Every request carries a stable per-browser X-Device-Id for the audit trail.
 */
import type {
  ActivityProfile, AIAssessment, AllocationPlan, Anomaly, CityForecast, Community, Complaint, ComplaintAnalysis, ComplaintCategory, ComplaintStatus,
  CrisisSignal, DashboardStats, PublicSummary, DeliveryRecord, Depot, DispatchProposal, DisasterEvent, DisasterImpact, DriverAssignment, ImpactStats, MlStatus, NewWaterRequest, Notification,
  OperationsSettings, Overview, PriorityWeights, RequestStatus, RouteOptimizationResult, SystemHealth, Trip, UrgencyLevel, UserProfile, UserRole,
  Vehicle, WaterRequest, OperationsMetrics, ImpactReplay, TapSchedule, SupplyNotice, PublicSupply, ScheduleKind, NoticeKind,
} from '../types';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let accessToken: string | null = null;
export const session = {
  get token() { return accessToken; },
  set(t: string | null) { accessToken = t; },
};

export function deviceId(): string {
  try {
    let id = localStorage.getItem('jalsetu_device_id');
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('jalsetu_device_id', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

let onSessionLost: (() => void) | null = null;
export const setSessionLostHandler = (fn: () => void) => { onSessionLost = fn; };

function errorMessage(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((d: any) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ');
  return fallback;
}

// Refresh tokens rotate and the server revokes the session if a rotated token is presented again,
// so concurrent refreshes must never race: callers in this tab share one in-flight request, and the
// Web Lock serialises refreshes across tabs (each tab then sends the cookie its predecessor rotated in).
let refreshing: Promise<{ accessToken: string; user: UserProfile } | null> | null = null;
export function refreshSession(): Promise<{ accessToken: string; user: UserProfile } | null> {
  if (!refreshing) {
    const run = () => doRefresh();
    refreshing = (navigator.locks ? navigator.locks.request('jalsetu-auth-refresh', run) : run())
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function doRefresh(): Promise<{ accessToken: string; user: UserProfile } | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Device-Id': deviceId() } });
    if (!res.ok) return null;
    const body = await res.json();
    accessToken = body.accessToken;
    return body;
  } catch {
    return null;
  }
}

async function tryRefresh(): Promise<boolean> {
  return !!(await refreshSession());
}

async function request<T>(path: string, init: RequestInit = {}, auth = true, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('X-Device-Id', deviceId());
  if (auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'Cannot reach the JalSetu server. Check the connection.');
  }
  if (res.status === 401 && auth && !retried) {
    if (await tryRefresh()) return request<T>(path, init, auth, true);
    onSessionLost?.();
  }
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, errorMessage(body, `${res.status} ${res.statusText}`));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) });

async function blobUrl(path: string): Promise<string> {
  const p = path.startsWith('/api') ? path.slice(4) : path;
  const go = () => fetch(`${API_BASE_URL}${p}`, { headers: { Authorization: `Bearer ${accessToken}`, 'X-Device-Id': deviceId() }, credentials: 'include' });
  let res = await go();
  if (res.status === 401 && await tryRefresh()) res = await go();
  if (!res.ok) throw new ApiError(res.status, 'File unavailable');
  return URL.createObjectURL(await res.blob());
}

type Session = { accessToken: string; user: UserProfile; expiresInSeconds: number };
export type ScheduleInput = { communityId: string; pointName: string; kind: ScheduleKind; days: number[]; startTime: string; endTime: string; notes?: string; isActive?: boolean };
export type PublicComplaintInput = { communityId: string; description: string; reporterName?: string; reporterPhone?: string; language?: 'en' | 'mr' | 'hi'; inputMode?: 'typed' | 'voice'; clientRef?: string; queuedAt?: string };

export const api = {
  // session
  login: async (email: string, password: string) => {
    const s = await request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
    accessToken = s.accessToken;
    return s;
  },
  logout: async () => { try { await request('/auth/logout', { method: 'POST' }, false); } finally { accessToken = null; } },
  me: () => get<UserProfile>('/auth/me'),
  changePassword: async (currentPassword: string, newPassword: string) => {
    const s = await post<Session>('/auth/change-password', { currentPassword, newPassword });
    accessToken = s.accessToken;
    return s;
  },
  users: (role?: UserRole) => get<UserProfile[]>(`/users${role ? `?role=${role}` : ''}`),
  createUser: (u: { email: string; name: string; password: string; role: UserRole; designation?: string; ward?: string; phone?: string }) => post<UserProfile>('/users', u),
  updateUser: (id: number, u: Partial<{ name: string; role: UserRole; isActive: boolean; password: string; phone: string }>) => patch<UserProfile>(`/users/${id}`, u),

  // command centre
  overview: () => get<Overview>('/overview'),
  health: () => get<SystemHealth>('/system/health'),
  notifications: () => get<{ unread: number; items: Notification[] }>('/notifications?limit=80'),
  markRead: (ids?: number[]) => request('/notifications/read', { method: 'POST', body: JSON.stringify(ids ?? null) }),
  anomalies: (status: 'open' | 'all' = 'open') => get<Anomaly[]>(`/anomalies?status=${status}`),
  acknowledgeAnomaly: (id: number, note: string) => post<Anomaly>(`/anomalies/${id}/acknowledge`, { note }),
  states: () => get<GeoJSON.FeatureCollection>('/geo/states'),
  districts: (stateId: number) => get<GeoJSON.FeatureCollection>(`/geo/states/${stateId}/districts`),
  geoStatus: () => get<{ states: number; districts: number; districtsWithLgdCode: number }>('/geo/status'),
  runIngestion: (key: string) => post<{ started: string }>(`/ingestion/${key}/run`),
  ingestionRuns: (source?: string) => get<any[]>(`/ingestion/runs${source ? `?source=${source}` : ''}`),

  // disasters
  disasters: (status: 'active' | 'all' = 'active') => get<DisasterEvent[]>(`/disasters?status=${status}`),
  disaster: (id: number) => get<DisasterEvent & { geometry: GeoJSON.Geometry | null }>(`/disasters/${id}`),
  disastersGeoJson: () => get<GeoJSON.FeatureCollection>('/disasters/geojson'),
  disasterImpact: (id: number) => get<DisasterImpact>(`/disasters/${id}/impact`),
  saveRecommendation: (id: number) => post<{ id: number }>(`/disasters/${id}/recommendations`),
  acknowledgeDisaster: (id: number, note = '') => post<DisasterEvent>(`/disasters/${id}/acknowledge`, { note }),
  recommendations: () => get<any[]>('/recommendations'),

  // fleet & tracking
  vehicles: () => get<{ serverTime: string; thresholds: { liveSeconds: number; offlineSeconds: number }; vehicles: Vehicle[] }>('/tracking/vehicles'),
  fleet: () => get<Vehicle[]>('/tankers'),
  vehicleHistory: (id: string, trip?: string) => get<{ lat: number; lng: number; deviceTime: string; accuracyM: number | null; speedKmh: number | null }[]>(`/tracking/vehicles/${id}/history${trip ? `?trip=${trip}` : ''}`),
  vehicleEta: (id: string) => get<{ available: boolean; reason?: string; kind?: string; method?: string; durationMin?: number; roadDistanceKm?: number; fromFixTime?: string; destination?: string }>(`/tracking/vehicles/${id}/eta`),
  createTanker: (t: Record<string, unknown>) => post<Vehicle>('/tankers', t),
  updateTanker: (id: string, t: Record<string, unknown>) => patch<Vehicle>(`/tankers/${id}`, t),
  breakdown: (id: string, note: string) => post<{ plan: AllocationPlan | null }>(`/tankers/${id}/breakdown`, { note, reallocate: true }),
  restoreTanker: (id: string) => post(`/tankers/${id}/restore`),
  depots: () => get<Depot[]>('/depots'),

  // crisis intelligence & auto-dispatch
  crisisSignals: () => get<CrisisSignal[]>('/crisis/signals'),
  reviewSignal: (id: number, status: CrisisSignal['status']) => patch<{ status: string }>(`/crisis/signals/${id}`, { status }),
  refreshCrisis: () => post<{ inCrisis: number; news: { created: number; error: string | null }; rainfall: { created: number; updated: number } }>('/crisis/refresh'),
  proposals: () => get<DispatchProposal[]>('/dispatch/proposals'),
  propose: () => post<{ batch: string; proposed: number; autoApproved: number[]; candidates: number; tankersAvailable: number }>('/dispatch/propose'),
  approveProposal: (id: number) => post<{ proposal: DispatchProposal; trip: Trip }>(`/dispatch/proposals/${id}/approve`),
  rejectProposal: (id: number, reason = '') => post<DispatchProposal>(`/dispatch/proposals/${id}/reject`, { reason }),
  createDepot: (d: { name: string; lat: number; lng: number; capacityLitres?: number }) => post<Depot>('/depots', d),

  // trips
  optimizeRoute: (tankerId: string, communityIds: string[], litres?: Record<string, number>) => post<RouteOptimizationResult>('/routes/optimize', { tankerId, communityIds, litres }),
  createTrip: (b: { tankerId: string; communityIds: string[]; driverUserId?: number; litres?: Record<string, number> }) => post<Trip>('/trips', b),
  trips: (active = false) => get<Trip[]>(`/trips?limit=200${active ? '&active=true' : ''}`),
  trip: (ref: string) => get<Trip>(`/trips/${ref}`),
  assignDriver: (ref: string, driverUserId: number) => post<Trip>(`/trips/${ref}/assign-driver`, { driverUserId }),
  cancelTrip: (ref: string, reason: string) => post<Trip>(`/trips/${ref}/cancel`, { reason }),

  // driver
  driverAssignment: () => get<DriverAssignment>('/driver/assignment'),
  acceptTrip: (ref: string) => post<Trip>(`/trips/${ref}/accept`),
  startTrip: (ref: string, fix: { lat: number; lng: number; accuracyM: number; speedKmh?: number | null; heading?: number | null; deviceTime: string }) =>
    post<Trip>(`/trips/${ref}/start`, { ...fix, source: 'phone_gps', deviceId: deviceId() }),
  confirmArrival: (ref: string) => post<Trip>(`/trips/${ref}/confirm-arrival`),
  recordDelivery: (ref: string, f: { deliveredAmount: number; receiverName: string; receiverPhone: string; notes: string; signature?: string; photo?: File | null }) => {
    const fd = new FormData();
    fd.set('deliveredAmount', String(f.deliveredAmount));
    fd.set('receiverName', f.receiverName);
    fd.set('receiverPhone', f.receiverPhone);
    fd.set('notes', f.notes);
    if (f.signature) fd.set('signature', f.signature);
    if (f.photo) fd.set('photo', f.photo);
    return request<{ delivery: DeliveryRecord; trip: Trip }>(`/trips/${ref}/deliveries`, { method: 'POST', body: fd });
  },
  endTrip: (ref: string) => post<Trip>(`/trips/${ref}/end`),
  sendTelemetry: (vehicleId: string, tripId: string, points: { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; heading: number | null; deviceTime: string }[]) =>
    post<{ accepted: number; duplicates: number; flagged: number; rejected: { index: number; reason: string }[]; arrivedAt: string | null; tripStatus: string; serverTime: string }>(
      '/tracking/telemetry', { vehicleId, tripId, source: 'phone_gps', deviceId: deviceId(), points }),

  // deliveries
  deliveries: () => get<DeliveryRecord[]>('/deliveries'),
  verifyDelivery: (id: string, notes = '') => post<DeliveryRecord & { tripCompleted: boolean }>(`/deliveries/${id}/verify`, { notes }),
  investigateDelivery: (id: string, notes = '') => post<DeliveryRecord>(`/deliveries/${id}/investigate`, { notes }),
  deliveryFile: (url: string) => blobUrl(url),

  // master data / demand
  communities: () => get<Community[]>('/communities'),
  createCommunity: (c: Record<string, unknown>) => post<Community>('/communities', c),
  updateCommunity: (id: string, c: Record<string, unknown>) => patch<Community>(`/communities/${id}`, c),
  communityForecast: (id: string, days = 7) => get<{ weatherSource: string; baseline: number; days: any[] }>(`/communities/${id}/forecast?days=${days}`),
  publicSummary: () => request<PublicSummary>('/public/summary', {}, false),
  publicCommunities: () => request<{ id: string; name: string; ward: string; lat: number; lng: number }[]>('/public/communities', {}, false),
  requests: () => get<WaterRequest[]>('/requests'),
  assessRequest: (r: NewWaterRequest) => post<AIAssessment>('/requests/assess', r),
  createRequest: (r: NewWaterRequest) => post<WaterRequest>('/requests', r),
  setRequestStatus: (id: string, status: RequestStatus) => patch<WaterRequest>(`/requests/${id}/status`, { status }),
  complaints: () => get<Complaint[]>('/complaints'),
  analyzeComplaint: (description: string, communityId?: string) => post<ComplaintAnalysis>('/complaints/analyze', { description, communityId }),
  createComplaint: (c: { communityId: string; description: string; reporterName?: string; reporterPhone?: string }) => post<Complaint>('/complaints', c),
  updateComplaint: (id: string, u: { status?: ComplaintStatus; assignedOfficer?: string; category?: ComplaintCategory; severity?: UrgencyLevel; confirmLabels?: boolean }) => patch<Complaint>(`/complaints/${id}`, u),
  publicComplaint: (c: PublicComplaintInput) =>
    request<{ id: string; category: string; severity: string; status: string; message: string; replayed: boolean }>('/public/complaints', { method: 'POST', body: JSON.stringify(c) }, false),

  // allocation
  currentPlan: () => get<{ plan: AllocationPlan | null; fleetSupply: number }>('/allocation/current'),
  runAllocation: (b: { totalSupply?: number; useForecast?: boolean; scope?: 'crisis_reach' | 'requests' | 'all' }) => post<AllocationPlan>('/allocation/run', b),
  approvePlan: (id: number) => post<AllocationPlan & { requestsAllocated: number }>(`/allocation/${id}/approve`),

  // analytics
  dashboard: () => get<DashboardStats>('/analytics/dashboard'),
  activity: (range: 'today' | '7d' | '30d', origin: 'all' | 'real' = 'all') => get<ActivityProfile>(`/analytics/activity?range=${range}&origin=${origin}`),
  forecast: (days = 7) => get<CityForecast>(`/analytics/forecast?days=${days}`),
  impact: () => get<ImpactStats>('/analytics/impact'),
  operations: (days: number, origin: 'all' | 'real' = 'all') => get<OperationsMetrics>(`/analytics/operations?days=${days}&origin=${origin}`),
  impactReplay: (days: number, origin: 'all' | 'real') => get<ImpactReplay>(`/analytics/impact-replay?days=${days}&origin=${origin}`),

  // tap schedules + supply notices
  schedules: (communityId?: string) => get<{ schedules: TapSchedule[]; notices: SupplyNotice[] }>(`/schedules${communityId ? `?community_id=${encodeURIComponent(communityId)}` : ''}`),
  createSchedule: (s: ScheduleInput) => post<TapSchedule>('/schedules', s),
  updateSchedule: (id: number, s: ScheduleInput) => put<TapSchedule>(`/schedules/${id}`, s),
  deleteSchedule: (id: number) => request<void>(`/schedules/${id}`, { method: 'DELETE' }),
  createNotice: (n: { communityId: string; kind: NoticeKind; message: string; startsAt?: string; endsAt?: string }) => post<SupplyNotice>('/supply-notices', n),
  endNotice: (id: number) => post<SupplyNotice>(`/supply-notices/${id}/end`),
  publicScheduleIndex: () => request<{ id: string; name: string; ward: string; schedules: number; hasNotice: boolean }[]>('/public/schedules', {}, false),
  publicSupply: (communityId: string) => request<PublicSupply>(`/public/supply/${encodeURIComponent(communityId)}`, {}, false),
  publicTicket: (code: string) => request<{ id: string; status: string; category: string; severity: string; community: string; submittedAt: string; resolvedAt: string | null }>(`/public/complaints/${encodeURIComponent(code)}`, {}, false),

  // settings, ML, audit, reports
  settings: () => get<{ weights: PriorityWeights; operations: OperationsSettings; defaults: { weights: PriorityWeights; operations: OperationsSettings } }>('/settings'),
  saveWeights: (w: PriorityWeights) => put<PriorityWeights>('/settings/weights', w),
  saveOperations: (o: Partial<OperationsSettings>) => put<OperationsSettings>('/settings/operations', o),
  mlStatus: () => get<MlStatus>('/ml/status'),
  retrain: (target: 'all' | 'complaints' | 'demand') => post<{ started: boolean }>(`/ml/retrain?target=${target}`),
  retrainStatus: () => get<{ running: boolean; log: string; returncode: number | null }>('/ml/retrain'),
  audit: (q = '') => get<any[]>(`/audit${q}`),
  downloadReport: async (kind: 'trips' | 'communities' | 'requests' | 'complaints' | 'deliveries' | 'allocation') => {
    const url = await blobUrl(`/reports/${kind}.csv`);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jalsetu-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  wsUrl: (): string => {
    const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
    return `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(accessToken || '')}`;
  },
};
