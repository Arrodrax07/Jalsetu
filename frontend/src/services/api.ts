/**
 * JalSetu API client. All calls go to the FastAPI backend (VITE_API_URL, default /api via the Vite proxy).
 */
import type {
  ActivityProfile, AllocationPlan, AIAssessment, CityForecast, Community, Complaint, ComplaintAnalysis,
  ComplaintCategory, ComplaintStatus, DashboardStats, DeliveryRecord, Depot, ImpactStats, MlStatus, NewWaterRequest,
  OperationsSettings, PriorityWeights, RequestStatus, RouteOptimizationResult, Tanker, Trip, UrgencyLevel, UserProfile,
  UserRole, WaterRequest,
} from '../types';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'jalsetu_token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get: (): string | null => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t: string | null) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function errorMessage(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail.map((d: any) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ');
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = tokenStore.get();
  if (auth && token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the JalSetu server. Check your connection.');
  }
  if (res.status === 401 && auth) {
    onUnauthorized?.();
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

async function download(path: string, filename: string) {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  // auth & users
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: UserProfile }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),
  me: () => get<UserProfile>('/auth/me'),
  users: () => get<UserProfile[]>('/users'),
  createUser: (u: { email: string; name: string; password: string; role: UserRole; designation?: string; ward?: string; phone?: string }) =>
    post<UserProfile>('/users', u),
  updateUser: (id: number, u: Partial<{ name: string; role: UserRole; isActive: boolean; password: string; designation: string; ward: string; phone: string }>) =>
    patch<UserProfile>(`/users/${id}`, u),

  // master data
  communities: () => get<Community[]>('/communities'),
  createCommunity: (c: Record<string, unknown>) => post<Community>('/communities', c),
  updateCommunity: (id: string, c: Record<string, unknown>) => patch<Community>(`/communities/${id}`, c),
  communityForecast: (id: string, days = 7) => get<{ weatherSource: string; baseline: number; days: any[] }>(`/communities/${id}/forecast?days=${days}`),
  depots: () => get<Depot[]>('/depots'),
  publicCommunities: () => request<{ id: string; name: string; ward: string }[]>('/public/communities', {}, false),

  // requests
  requests: () => get<WaterRequest[]>('/requests'),
  assessRequest: (r: NewWaterRequest) => post<AIAssessment>('/requests/assess', r),
  createRequest: (r: NewWaterRequest) => post<WaterRequest>('/requests', r),
  setRequestStatus: (id: string, status: RequestStatus) => patch<WaterRequest>(`/requests/${id}/status`, { status }),

  // complaints
  complaints: () => get<Complaint[]>('/complaints'),
  analyzeComplaint: (description: string, communityId?: string) => post<ComplaintAnalysis>('/complaints/analyze', { description, communityId }),
  createComplaint: (c: { communityId: string; description: string; reporterName?: string; reporterPhone?: string }) => post<Complaint>('/complaints', c),
  updateComplaint: (id: string, u: { status?: ComplaintStatus; assignedOfficer?: string; category?: ComplaintCategory; severity?: UrgencyLevel; confirmLabels?: boolean }) =>
    patch<Complaint>(`/complaints/${id}`, u),
  publicComplaint: (c: { communityId: string; description: string; reporterName?: string; reporterPhone?: string }) =>
    request<{ id: string; category: string; severity: string; status: string; message: string }>('/public/complaints', { method: 'POST', body: JSON.stringify(c) }, false),

  // allocation
  currentPlan: () => get<{ plan: AllocationPlan | null; fleetSupply: number }>('/allocation/current'),
  planHistory: () => get<Omit<AllocationPlan, 'items'>[]>('/allocation/history'),
  runAllocation: (body: { totalSupply?: number; useForecast?: boolean }) => post<AllocationPlan>('/allocation/run', body),
  approvePlan: (id: number) => post<AllocationPlan & { requestsAllocated: number }>(`/allocation/${id}/approve`),

  // fleet
  tankers: () => get<Tanker[]>('/tankers'),
  createTanker: (t: Record<string, unknown>) => post<Tanker>('/tankers', t),
  updateTanker: (id: string, t: Record<string, unknown>) => patch<Tanker>(`/tankers/${id}`, t),
  breakdown: (id: string, note: string) => post<{ tankerId: string; plan: AllocationPlan | null }>(`/tankers/${id}/breakdown`, { note, reallocate: true }),
  restoreTanker: (id: string) => post<{ tankerId: string }>(`/tankers/${id}/restore`),
  optimizeRoute: (tankerId: string, communityIds: string[], litres?: Record<string, number>) =>
    post<RouteOptimizationResult>('/routes/optimize', { tankerId, communityIds, litres }),
  dispatch: (tankerId: string, communityIds: string[], litres?: Record<string, number>) =>
    post<Trip & { optimization: RouteOptimizationResult }>('/trips', { tankerId, communityIds, litres }),
  trips: (active = false) => get<Trip[]>(`/trips${active ? '?active=true' : ''}`),
  cancelTrip: (dbId: number) => post<Trip>(`/trips/${dbId}/cancel`),
  driverTrip: () => get<{ tanker: Tanker; trip: Trip | null }>('/driver/trip'),
  ping: (p: { lat: number; lng: number; speedKmh?: number | null; heading?: number | null; accuracyM?: number | null }) => post<{ ok: boolean }>('/tracking/ping', p),
  trail: (tankerId: string) => get<[number, number][]>(`/tracking/${tankerId}/trail`),

  // deliveries
  deliveries: () => get<DeliveryRecord[]>('/deliveries'),
  recordDelivery: (f: { tripStopId: number; deliveredAmount: number; lat?: number; lng?: number; notes?: string; photo?: File | null }) => {
    const fd = new FormData();
    fd.set('tripStopId', String(f.tripStopId));
    fd.set('deliveredAmount', String(f.deliveredAmount));
    if (f.lat !== undefined && f.lng !== undefined) { fd.set('lat', String(f.lat)); fd.set('lng', String(f.lng)); }
    if (f.notes) fd.set('notes', f.notes);
    if (f.photo) fd.set('photo', f.photo);
    return request<DeliveryRecord>('/deliveries', { method: 'POST', body: fd });
  },
  verifyDelivery: (id: string, notes = '') => post<DeliveryRecord>(`/deliveries/${id}/verify`, { notes }),
  investigateDelivery: (id: string, notes = '') => post<DeliveryRecord>(`/deliveries/${id}/investigate`, { notes }),
  deliveryPhoto: async (photoUrl: string): Promise<string> => {
    const token = tokenStore.get();
    const res = await fetch(photoUrl.startsWith('/api') ? `${API_BASE_URL}${photoUrl.slice(4)}` : photoUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, 'Photo unavailable');
    return URL.createObjectURL(await res.blob());
  },

  // analytics
  dashboard: () => get<DashboardStats>('/analytics/dashboard'),
  activity: (range: 'today' | '7d' | '30d') => get<ActivityProfile>(`/analytics/activity?range=${range}`),
  forecast: (days = 7) => get<CityForecast>(`/analytics/forecast?days=${days}`),
  impact: () => get<ImpactStats>('/analytics/impact'),

  // settings, ML, reports
  settings: () => get<{ weights: PriorityWeights; operations: OperationsSettings; defaults: { weights: PriorityWeights; operations: OperationsSettings } }>('/settings'),
  saveWeights: (w: PriorityWeights) => put<PriorityWeights>('/settings/weights', w),
  saveOperations: (o: Partial<OperationsSettings>) => put<OperationsSettings>('/settings/operations', o),
  mlStatus: () => get<MlStatus>('/ml/status'),
  retrain: (target: 'all' | 'complaints' | 'demand') => post<{ started: boolean }>(`/ml/retrain?target=${target}`),
  retrainStatus: () => get<{ running: boolean; log: string; returncode: number | null }>('/ml/retrain'),
  audit: () => get<{ id: number; user: string; action: string; entity: string; entityId: string; details: any; createdAt: string }[]>('/audit'),
  downloadReport: (kind: 'communities' | 'requests' | 'complaints' | 'deliveries' | 'allocation') =>
    download(`/reports/${kind}.csv`, `jalsetu-${kind}-${new Date().toISOString().slice(0, 10)}.csv`),

  wsUrl: (): string => {
    const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
    return `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(tokenStore.get() || '')}`;
  },
};
