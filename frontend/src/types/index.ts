// Wire types for the JalSetu API (backend/app/services/views.py). Timestamps are ISO-8601 UTC.

export type UrgencyLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type VulnerabilityLevel = 'Low' | 'Medium' | 'High' | 'Very High';
export type RequestStatus = 'Pending' | 'Allocated' | 'Dispatched' | 'Delivered' | 'Rejected';
export type ComplaintCategory =
  | 'No Water'
  | 'Late Tanker'
  | 'Insufficient Quantity'
  | 'Poor Water Quality'
  | 'Missed Delivery'
  | 'Billing or Other';
export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
  'No Water', 'Late Tanker', 'Insufficient Quantity', 'Poor Water Quality', 'Missed Delivery', 'Billing or Other'
];
export type ComplaintStatus = 'Pending' | 'Escalated' | 'Assigned' | 'Resolved';
export type TankerStatus = 'Loading' | 'En Route' | 'Idle' | 'Maintenance';
export type DeliveryStatus = 'Pending Verification' | 'Verified' | 'Mismatch' | 'Under Investigation';
export type UserRole = 'admin' | 'officer' | 'driver';

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  designation: string;
  ward: string;
  phone: string;
  isActive: boolean;
  tankerId: string | null;
}

export interface PriorityFactors {
  demand: number;
  vulnerability: number;
  unmetNeed: number;
  previousCoverage: number;
  population: number;
}

export interface Community {
  id: string;
  name: string;
  ward: string;
  population: number;
  dailyDemand: number;
  allocatedWater: number;
  availableWater: number;
  shortfall: number;
  vulnerability: VulnerabilityLevel;
  vulnerabilityScore: number;
  previousAllocation: number;
  currentCoverage: number;
  lastDelivery: string | null;
  openComplaints: number;
  repeatedComplaints: number;
  priorityScore: number;
  priorityFactors: PriorityFactors;
  lat: number;
  lng: number;
  status: 'Normal' | 'High Demand' | 'Critical' | 'Recently Served';
  contactOfficer: string;
  officerPhone: string;
  isActive: boolean;
}

export interface AIAssessment {
  demandLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedShortfall: number;
  priorityScore: number;
  urgency: UrgencyLevel;
  factors: PriorityFactors;
  contributions: PriorityFactors;
  weights: PriorityWeights;
  reasoning: string;
}

export interface WaterRequest {
  id: string;
  dbId: number;
  communityId: string;
  communityName: string;
  requestedAmount: number;
  urgency: UrgencyLevel;
  population: number;
  peopleCurrentlyServed: number;
  vulnerability: VulnerabilityLevel;
  reason: string;
  daysWithoutWater: number;
  contactPerson: string;
  phone: string;
  submittedAt: string;
  status: RequestStatus;
  priorityScore: number;
  aiAssessment: AIAssessment | null;
}

export interface NewWaterRequest {
  communityId: string;
  requestedAmount: number;
  peopleCurrentlyServed: number;
  reason: string;
  daysWithoutWater: number;
  contactPerson: string;
  phone: string;
}

export interface ComplaintAnalysis {
  category: ComplaintCategory;
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  severity: UrgencyLevel;
  severityConfidence: number;
  sentiment: 'Negative' | 'Neutral' | 'Critical';
  duplicateOf: string | null;
  duplicateProbability: number;
  similarComplaintsCount: number;
  isRepeated: boolean;
  recommendedAction: string;
  modelVersion: string;
}

export interface Complaint {
  id: string;
  dbId: number;
  communityId: string;
  communityName: string;
  category: ComplaintCategory;
  categoryConfidence: number;
  description: string;
  sentiment: 'Negative' | 'Neutral' | 'Critical';
  severity: UrgencyLevel;
  severityConfidence: number;
  isRepeated: boolean;
  similarComplaintsCount: number;
  duplicateOf: string | null;
  status: ComplaintStatus;
  assignedOfficer: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  duplicateProbability: number;
  recommendedAction: string;
  labelVerified: boolean;
  source: 'officer' | 'citizen';
  reporterName: string;
}

export interface Depot {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export interface Tanker {
  id: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  driverUserId: number | null;
  capacity: number;
  currentLoad: number;
  status: TankerStatus;
  currentLocationName: string;
  destinationCommunity: string;
  eta: string;
  speedKmH: number;
  progressPercent: number;
  currentCoordinates: [number, number];
  routeWaypoints: [number, number][];
  stops: string[];
  isDisrupted: boolean;
  breakdownNote: string | null;
  activeTripId: string | null;
  lastPingAt: string | null;
  gpsOnline: boolean;
  depot: Depot | null;
}

export interface TripStop {
  id: number;
  seq: number;
  communityId: string;
  communityName: string;
  lat: number;
  lng: number;
  allocatedLitres: number;
  status: 'Pending' | 'Delivered' | 'Skipped';
}

export interface Trip {
  id: string;
  dbId: number;
  tankerId: string;
  vehicleNumber: string;
  status: 'Planned' | 'En Route' | 'Completed' | 'Cancelled';
  distanceKm: number;
  durationMin: number;
  baselineDistanceKm: number;
  baselineDurationMin: number;
  routingSource: string;
  routeGeometry: [number, number][];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  stops: TripStop[];
}

export interface DeliveryRecord {
  id: string;
  dbId: number;
  tankerId: string;
  vehicleNumber: string;
  communityId: string;
  communityName: string;
  allocatedAmount: number;
  deliveredAmount: number;
  deliveryTime: string;
  gpsVerified: boolean;
  geofenceDistanceM: number | null;
  officerVerified: boolean;
  verifiedBy: string | null;
  status: DeliveryStatus;
  varianceAmount: number;
  notes: string;
  fieldOfficer: string;
  recordedBy: string;
  photoUrl: string | null;
  tripMinutes: number | null;
}

export interface PriorityWeights {
  demand: number;
  vulnerability: number;
  unmetNeed: number;
  previousCoverage: number;
  population: number;
}

export interface OperationsSettings {
  tripsPerDay: number;
  survivalLitresPerPerson: number;
  minCoveragePct: number;
  protectVulnerabilityAbove: number;
  dieselPricePerLitre: number;
  tankerKmPerLitre: number;
  co2KgPerLitreDiesel: number;
  fallbackSpeedKmh: number;
  roadCircuityFactor: number;
  geofenceRadiusM: number;
  varianceTolerancePct: number;
  duplicateSimilarity: number;
}

export interface FairnessMetrics {
  needWeightedEquity: number;
  coverageEquality: number;
  minCoveragePct: number;
  avgCoveragePct: number;
  vulnerableCoveragePct: number;
}

export interface AllocationPlanItem {
  communityId: string;
  communityName: string;
  demand: number;
  available: number;
  previousAllocation: number;
  priorityScore: number;
  survivalFloor: number;
  recommendedAllocation: number;
  coveragePct: number;
  reason: string;
  status: 'Proposed' | 'Approved';
  factors: { subscores: PriorityFactors; contributions: PriorityFactors };
}

export interface AllocationPlan {
  id: number;
  status: 'Proposed' | 'Approved' | 'Superseded';
  totalSupply: number;
  totalDemand: number;
  fairnessBefore: number;
  fairnessAfter: number;
  weights: PriorityWeights;
  method: string;
  demandSource: string;
  disruption: { tankerId: string; lostLitres: number; note?: string } | null;
  metricsBefore: FairnessMetrics;
  metricsAfter: FairnessMetrics;
  notes: string[];
  createdAt: string;
  approvedAt: string | null;
  items: AllocationPlanItem[];
}

export interface RouteOptimizationResult {
  tankerId: string;
  vehicleNumber: string;
  depot: { name: string; lat: number; lng: number };
  stops: string[];
  recommendedSequence: string[];
  sequence: { communityId: string; name: string; lat: number; lng: number; priorityScore: number; litres: number }[];
  distanceBeforeKm: number;
  distanceAfterKm: number;
  distanceSavedKm: number;
  timeBeforeMin: number;
  timeAfterMin: number;
  timeSavedMin: number;
  fuelLitresAfter: number;
  fuelSavedInr: number;
  co2SavedKg: number;
  routeGeometry: [number, number][];
  routingSource: string;
  assumptions: Record<string, string | number>;
}

export interface DashboardStats {
  fleetTotal: number;
  fleetOperational: number;
  tankersActive: number;
  communitiesTotal: number;
  communitiesServed: number;
  underserved: number;
  requestsLast24h: number;
  requestsChangePct: number | null;
  complaintsResolved24h: number;
  avgDeliveryMinutes: number | null;
  avgDeliveryChangeMin: number | null;
  coverageBalance: number | null;
  coverageEquality: number | null;
  minCoveragePct: number | null;
  lastPlanFairnessGain: number | null;
  routeTrips30d: number;
  routeAvgKmSaved: number | null;
  routeAvgFuelSavedInr: number | null;
}

export interface ForecastDay {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  baseline: number;
  tempMax: number;
  precipMm: number;
}

export interface CityForecast {
  days: ForecastDay[];
  weatherSource: string | null;
  communities: { communityId: string; name: string; baseline: number; days: { date: string; litres_p50: number }[] }[];
  model: Record<string, unknown> | null;
}

export interface ActivityProfile {
  range: string;
  hourly: { hour: string; requests: number; complaints: number }[];
  daily: { date: string; requests: number; complaints: number }[];
}

export interface ImpactStats {
  fairnessSeries: { date: string; before: number; after: number; minCoverageAfter: number | null }[];
  coverageComparison: { community: string; before: number; after: number; vulnerability: number }[];
  complaints: {
    total: number; duplicatesDetected: number; duplicateRatePct: number | null; resolved: number;
    avgResolutionHours: number | null; byCategory: Record<string, number>; bySeverity: Record<string, number>;
    officerVerifiedLabels: number; modelAgreementPct: number | null;
  };
  routing: { trips: number; kmSaved: number; kmSavedPct: number | null; fuelSavedLitres: number; fuelSavedInr: number; co2SavedKg: number };
  deliveries: { total: number; litresDelivered: number; verified: number; mismatches: number; geofencePassPct: number | null; netVarianceLitres: number };
  requests: { total: number; delivered: number; open: number };
}

export interface MlStatus {
  complaintClassifier: { loaded: boolean; meta: Record<string, unknown> | null; error: string | null };
  demandForecaster: { loaded: boolean; meta: Record<string, unknown> | null; error: string | null };
  metrics: Record<string, any>;
}
