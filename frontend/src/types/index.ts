// Wire types for the JalSetu API. Timestamps are ISO-8601 UTC ("...Z").

export type UrgencyLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type VulnerabilityLevel = 'Low' | 'Medium' | 'High' | 'Very High';
export type RequestStatus = 'Pending' | 'Allocated' | 'Dispatched' | 'Delivered' | 'Rejected' | 'Merged';
export type ComplaintCategory = 'No Water' | 'Late Tanker' | 'Insufficient Quantity' | 'Poor Water Quality' | 'Missed Delivery' | 'Billing or Other';
export const COMPLAINT_CATEGORIES: ComplaintCategory[] = ['No Water', 'Late Tanker', 'Insufficient Quantity', 'Poor Water Quality', 'Missed Delivery', 'Billing or Other'];
export type ComplaintStatus = 'Pending' | 'Escalated' | 'Assigned' | 'Resolved';
export type TankerStatus = 'Available' | 'Assigned' | 'On Trip' | 'Maintenance';
export type TripStatus = 'Planned' | 'Assigned' | 'Accepted' | 'En Route' | 'Arrived' | 'Delivering' | 'Delivered' | 'Completed' | 'Cancelled';
export type DeliveryStatus = 'Pending Verification' | 'Verified' | 'Mismatch' | 'Under Investigation';
export type UserRole = 'admin' | 'operator' | 'dispatcher' | 'driver';
export type DataOrigin = 'seeded' | 'manual' | 'external' | 'citizen' | 'synthetic';
export type TrackingState = 'live' | 'stale' | 'offline' | 'no_signal';

export interface UserProfile {
  id: number; name: string; email: string; role: UserRole; designation: string; ward: string; phone: string;
  isActive: boolean; tankerId: string | null; mustChangePassword: boolean; permissions: string[];
}

export interface PriorityFactors { demand: number; vulnerability: number; unmetNeed: number; previousCoverage: number; population: number; liveCrisis?: number; waterAccess?: number }

export interface Community {
  id: string; name: string; ward: string; population: number; dailyDemand: number; allocatedWater: number; availableWater: number;
  shortfall: number; vulnerability: VulnerabilityLevel; vulnerabilityScore: number; previousAllocation: number; currentCoverage: number;
  lastDelivery: string | null; openComplaints: number; repeatedComplaints: number; priorityScore: number; priorityFactors: PriorityFactors;
  lat: number; lng: number; status: 'Normal' | 'High Demand' | 'Critical' | 'Recently Served'; contactOfficer: string; officerPhone: string;
  isActive: boolean; dataOrigin: DataOrigin; districtId: number | null; districtName: string | null; stateName: string | null;
  /** Estimated piped/municipal supply (litres/day); tankers cover the rest. */
  baselineSupply?: number; tankerNeed?: number;
  /** 0-100 from live crisis signals (news + rainfall deficit). */
  crisisScore?: number; settlementType?: string | null; source?: string | null; sourceUrl?: string | null; demandBasis?: string | null;
  /** Straight-line km to the nearest recorded water source or active depot. */
  waterAccessKm?: number | null; waterAccessNote?: string | null;
}

export interface CrisisSignal {
  id: number; kind: 'news' | 'rainfall_deficit'; title: string; summary: string; url: string; publisher: string; publishedAt: string | null;
  severity: 'Severe' | 'Moderate' | 'Minor'; metric: number | null; status: 'unverified' | 'confirmed' | 'dismissed';
  communities: { id: string; name: string }[]; districts: { id: number; name: string }[];
  matchedTerms: { term: string; scope: 'community' | 'district' | 'region' }[]; regionOnly: boolean;
  reviewedBy: string | null; reviewedAt: string | null; expiresAt: string | null; active: boolean;
}

export interface DispatchProposal {
  id: number; batch: string; status: 'Proposed' | 'Approved' | 'Rejected' | 'Expired'; auto: boolean; score: number;
  tankerId: string; vehicleNumber: string; depot: string | null; stops: { communityId: string; name: string; litres: number }[];
  estDistanceKm: number; reasons: string[]; tripId: number | null; tripCode: string | null;
  createdAt: string; decidedAt: string | null; decidedBy: string | null;
}

export interface AIAssessment {
  demandLevel: string; vulnerability: string; estimatedShortfall: number; priorityScore: number; urgency: UrgencyLevel;
  factors: PriorityFactors; contributions: PriorityFactors; weights: PriorityWeights; reasoning: string;
  possibleDuplicateOf?: string | null; duplicateWindowHours?: number;
}

export interface WaterRequest {
  id: string; dbId: number; communityId: string; communityName: string; requestedAmount: number; urgency: UrgencyLevel; population: number;
  peopleCurrentlyServed: number; vulnerability: VulnerabilityLevel; reason: string; daysWithoutWater: number; contactPerson: string; phone: string;
  submittedAt: string; status: RequestStatus; priorityScore: number; aiAssessment: AIAssessment | null; dataOrigin: DataOrigin; fulfilledAt: string | null;
  duplicateOf: string | null; duplicateReason: string | null;
  source?: 'staff' | 'citizen'; peopleAffected?: number | null; language?: 'en' | 'mr' | 'hi'; inputMode?: 'typed' | 'voice'; queuedAt?: string | null;
}
export interface NewWaterRequest { communityId: string; requestedAmount: number; peopleCurrentlyServed: number; reason: string; daysWithoutWater: number; contactPerson: string; phone: string; allowDuplicate?: boolean }

export interface ComplaintAnalysis {
  category: ComplaintCategory; categoryConfidence: number; categoryProbabilities: Record<string, number>; severity: UrgencyLevel; severityConfidence: number;
  sentiment: string; duplicateOf: string | null; duplicateProbability: number; similarComplaintsCount: number; isRepeated: boolean; recommendedAction: string; modelVersion: string;
}
export interface Complaint {
  id: string; dbId: number; communityId: string; communityName: string; category: ComplaintCategory; categoryConfidence: number; description: string;
  sentiment: string; severity: UrgencyLevel; severityConfidence: number; isRepeated: boolean; similarComplaintsCount: number; duplicateOf: string | null;
  status: ComplaintStatus; assignedOfficer: string | null; submittedAt: string; resolvedAt: string | null; duplicateProbability: number;
  recommendedAction: string; labelVerified: boolean; source: 'officer' | 'citizen'; reporterName: string; dataOrigin: DataOrigin;
  language?: 'en' | 'mr' | 'hi'; inputMode?: 'typed' | 'voice'; queuedAt?: string | null;
}

export interface Depot { id: number; name: string; lat: number; lng: number; dataOrigin: DataOrigin; stockLitres: number | null; stockUpdatedAt: string | null; isActive?: boolean; placementNote?: string }

export interface VehiclePosition {
  lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; heading: number | null; headingLabel: string | null;
  deviceTime: string | null; receivedAt: string | null; source: string | null; sourceLabel: string | null;
}
export interface VehicleTripRef {
  id: string; dbId: number; status: TripStatus; destination: string | null; destinationId: string | null;
  destinationLat: number | null; destinationLng: number | null; stopSeq: number | null; distanceToDestinationM: number | null;
}
export interface Vehicle {
  vehicleId: string; registration: string; status: TankerStatus; driverName: string; driverUserId: number | null; trackingSource: string;
  position: VehiclePosition | null; trackingState: TrackingState; ageSeconds: number | null; trip: VehicleTripRef | null;
  // fleet-list extras
  id?: string; vehicleNumber?: string; driverPhone?: string; capacity?: number; currentLoad?: number; isDisrupted?: boolean; breakdownNote?: string | null;
  activeTripId?: string | null; routeWaypoints?: [number, number][]; stops?: string[]; progressPercent?: number; depot?: Depot | null; dataOrigin?: DataOrigin;
}

export interface TripStop {
  id: number; seq: number; communityId: string; communityName: string; lat: number; lng: number; allocatedLitres: number;
  status: 'Pending' | 'Arrived' | 'Delivered' | 'Verified' | 'Skipped'; arrivedAt: string | null; arrivalDistanceM: number | null;
  arrivalConfirmedAt: string | null; deliveredAt: string | null; verifiedAt: string | null; dataOrigin: DataOrigin;
}
export interface Anomaly {
  id: number; kind: string; vehicleId: string | null; tripId: string | null; detectedAt: string; lat: number | null; lng: number | null;
  value: number | null; details: Record<string, unknown>; status: 'open' | 'acknowledged' | 'resolved'; acknowledgedBy: string | null;
  acknowledgedAt: string | null; note: string; resolvedAt: string | null;
}
export interface Trip {
  id: string; dbId: number; tankerId: string; vehicleNumber: string; driverUserId: number | null; driverName: string | null; status: TripStatus;
  distanceKm: number; durationMin: number; baselineDistanceKm: number; baselineDurationMin: number; routingSource: string; routeGeometry: [number, number][];
  createdAt: string; assignedAt: string | null; acceptedAt: string | null; startedAt: string | null; startLat: number | null; startLng: number | null;
  arrivedAt: string | null; driverEndedAt: string | null; verifiedAt: string | null; completedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  distanceTravelledKm: number; geofenceRadiusM: number; stops: TripStop[];
  // detail only
  actualRoute?: [number, number][]; actualPointCount?: number; dispatchRouteGeometry?: [number, number][]; deliveries?: DeliveryRecord[];
  anomalies?: Anomaly[]; timeline?: { at: string; action: string; by: string; details: Record<string, unknown> }[];
}

export interface DeliveryRecord {
  id: string; dbId: number; tankerId: string; vehicleNumber: string; communityId: string; communityName: string; allocatedAmount: number; deliveredAmount: number;
  deliveryTime: string; gpsVerified: boolean; geofenceDistanceM: number | null; officerVerified: boolean; verifiedBy: string | null; status: DeliveryStatus;
  varianceAmount: number; notes: string; fieldOfficer: string; recordedBy: string; photoUrl: string | null; signatureUrl: string | null; tripMinutes: number | null;
  tripId: string | null; receiverName: string; receiverPhone: string; verifiedAt: string | null; verificationNotes: string; gpsDeviceTime: string | null;
}

export interface PriorityWeights { demand: number; vulnerability: number; unmetNeed: number; previousCoverage: number; population: number; liveCrisis: number; waterAccess: number }
export interface OperationsSettings {
  tripsPerDay: number; survivalLitresPerPerson: number; minCoveragePct: number; protectVulnerabilityAbove: number; dieselPricePerLitre: number;
  tankerKmPerLitre: number; co2KgPerLitreDiesel: number; fallbackSpeedKmh: number; roadCircuityFactor: number; geofenceRadiusM: number;
  varianceTolerancePct: number; duplicateSimilarity: number; liveSeconds: number; offlineSeconds: number; arrivalConsecutiveFixes: number;
  arrivalMaxAccuracyM: number; startMaxAccuracyM: number; maxPlausibleSpeedKmh: number; lowAccuracyM: number; deviationThresholdM: number;
  deviationConsecutiveFixes: number; prolongedStopMinutes: number; maxClockSkewSeconds: number; maxBufferedAgeHours: number;
  requireReceiverName: boolean; requireProofForVerification: boolean;
  requestDuplicateHours: number; tankerShiftHours: number; stopServiceMinutes: number;
}

export interface FairnessMetrics { needWeightedEquity: number; coverageEquality: number; minCoveragePct: number; avgCoveragePct: number; vulnerableCoveragePct: number }
export interface AllocationPlanItem {
  communityId: string; communityName: string; demand: number; available: number; previousAllocation: number; priorityScore: number; survivalFloor: number;
  recommendedAllocation: number; coveragePct: number; reason: string; status: 'Proposed' | 'Approved'; factors: { subscores: PriorityFactors; contributions: PriorityFactors };
}
export interface AllocationPlan {
  id: number; status: 'Proposed' | 'Approved' | 'Superseded'; totalSupply: number; totalDemand: number; fairnessBefore: number; fairnessAfter: number;
  weights: PriorityWeights; method: string; demandSource: string; disruption: { tankerId: string; lostLitres: number; note?: string } | null;
  metricsBefore: FairnessMetrics; metricsAfter: FairnessMetrics; notes: string[]; scope?: string; scopeLabel?: string | null; createdAt: string; approvedAt: string | null; items: AllocationPlanItem[];
}

export interface RouteOptimizationResult {
  tankerId: string; vehicleNumber: string; depot: { name: string; lat: number; lng: number }; stops: string[]; recommendedSequence: string[];
  sequence: { communityId: string; name: string; lat: number; lng: number; priorityScore: number; litres: number }[];
  distanceBeforeKm: number; distanceAfterKm: number; distanceSavedKm: number; timeBeforeMin: number; timeAfterMin: number; timeSavedMin: number;
  fuelLitresAfter: number; fuelSavedInr: number; co2SavedKg: number; routeGeometry: [number, number][]; routingSource: string; assumptions: Record<string, string | number>;
}

export interface DisasterEvent {
  id: number; source: string; sourceLabel: string; externalId: string; provider: string; sourceUrl: string; eventType: string; eventRaw: string; category: string;
  severity: string; urgency: string; certainty: string; msgType: string; headline: string; description: string; instruction: string; areaDesc: string;
  lgdDistrictCodes: string[]; hasGeometry: boolean; geometryStatus: string; bbox: number[] | null; centroid: [number, number] | null;
  effectiveAt: string | null; onsetAt: string | null; expiresAt: string | null; publishedAt: string | null; retrievedAt: string; lastUpdated: string;
  status: 'active' | 'expired' | 'cancelled'; acknowledgedBy: string | null; acknowledgedAt: string | null; dataOrigin: 'external';
}
export interface ImpactFactor { factor: string; value: string | number; source: string }
export interface DisasterImpact {
  eventId: number; method: 'polygon' | 'lgd_district_codes' | 'none'; radiusKm: number;
  communities: { id: string; name: string; population: number; vulnerabilityScore: number; dataOrigin: DataOrigin; shortfall: number }[];
  populationInRecords: number; openRequests: { id: string; community: string; litres: number; status: string; priority: number }[]; openRequestLitres: number;
  vulnerableCommunities: string[]; tripsAffected: { id: string; status: string; vehicle: string; routeIntersects: boolean; stopInArea: boolean }[];
  availableTankersNearby: { id: string; vehicle: string; capacity: number; distanceKm: number; basis: string }[];
  depotsNearby: { id: number; name: string; distanceKm: number; stockLitres: number | null }[]; computedAt: string;
  recommendation: { headline: string; actions: string[]; factors: ImpactFactor[]; kind: string };
}

export interface Overview {
  serverTime: string; istDayStart: string; activeAlerts: number; activeEmergencies: number; alertFeedStatus: string; alertFeedLastSuccess: string | null;
  activeRequests: number; criticalRequests: number; tankersOnRoad: number; tankersAvailable: number; tankersTotal: number; vehiclesLive: number;
  vehiclesStale: number; vehiclesOffline: number; openTrips: number; deliveriesToday: number; litresDeliveredToday: number; tripsCompletedToday: number;
  communitiesAffected: number; communitiesTotal: number; openComplaints: number; openAnomalies: number; pendingVerifications: number;
}

export interface Notification { id: number; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string; entity: string; entityId: string; createdAt: string; read: boolean }

export interface SourceHealth {
  key: string; name: string; provider: string; kind: string; status: string; lastSuccessAt: string | null; lastAttemptAt: string | null; lastError: string | null;
  url: string; access: string; auth: string; frequency: string; license: string; env: string;
}
export interface SystemHealth {
  serverTime: string; database: { status: string; latencyMs: number | null; engine: string };
  ml: { complaintClassifier: string; demandForecaster: string; errors: Record<string, string> };
  gpsIngestion: { status: string; lastFixReceivedAt: string | null; fixesLast10Min: number; vehiclesLive: number }; backgroundJobs: boolean; sources: SourceHealth[];
}

export interface DashboardStats {
  fleetTotal: number; fleetOperational: number; tankersActive: number; communitiesTotal: number; communitiesServed: number; underserved: number;
  requestsLast24h: number; requestsChangePct: number | null; complaintsResolved24h: number; avgDeliveryMinutes: number | null; avgDeliveryChangeMin: number | null;
  coverageBalance: number | null; coverageEquality: number | null; minCoveragePct: number | null; lastPlanFairnessGain: number | null;
  routeTrips30d: number; routeAvgKmSaved: number | null; routeAvgFuelSavedInr: number | null;
}
export interface CityForecast { days: { date: string; p10: number; p50: number; p90: number; baseline: number; tempMax: number; precipMm: number }[]; weatherSource: string | null; places?: number; communities: unknown[]; model: Record<string, unknown> | null }
export interface ActivityProfile { range: string; origin?: 'all' | 'real'; syntheticRecords?: number; hourly: { hour: string; requests: number; complaints: number }[]; daily: { date: string; requests: number; complaints: number }[] }
export interface ImpactStats {
  fairnessSeries: { date: string; before: number; after: number; minCoverageAfter: number | null }[];
  coverageComparison: { community: string; before: number; after: number; vulnerability: number }[];
  complaints: { total: number; duplicatesDetected: number; duplicateRatePct: number | null; resolved: number; avgResolutionHours: number | null; byCategory: Record<string, number>; bySeverity: Record<string, number>; officerVerifiedLabels: number; modelAgreementPct: number | null };
  routing: { trips: number; kmSaved: number; kmSavedPct: number | null; fuelSavedLitres: number; fuelSavedInr: number; co2SavedKg: number };
  deliveries: { total: number; litresDelivered: number; verified: number; mismatches: number; geofencePassPct: number | null; netVarianceLitres: number };
  requests: { total: number; delivered: number; open: number };
}
export interface MlStatus { complaintClassifier: { loaded: boolean; meta: Record<string, unknown> | null; error: string | null }; demandForecaster: { loaded: boolean; meta: Record<string, unknown> | null; error: string | null }; metrics: Record<string, any> }

export interface DriverAssignment {
  vehicle: Vehicle | null; trip: Trip | null; serverTime: string;
  thresholds: { geofenceRadiusM: number; arrivalConsecutiveFixes: number; arrivalMaxAccuracyM: number; startMaxAccuracyM: number; liveSeconds: number; offlineSeconds: number };
}

export interface OperationsMetrics {
  windowDays: number; tripsCreated: number; tripsStarted: number; tripsCompleted: number; tripsCancelled: number; completionRatePct: number | null;
  avgDispatchToStartMin: number | null; avgStartToArrivalMin: number | null; avgStartToCompletionMin: number | null; gpsKmTravelled: number;
  deliveries: number; deliveriesVerified: number; litresDelivered: number; requestsCreated: number; requestsFulfilled: number;
  avgRequestToFulfilmentHours: number | null; fleetUtilisationPct: number | null; anomaliesByKind: Record<string, number>; routeDeviations: number;
  daily: { date: string; trips: number; litres: number }[];
  origin: 'all' | 'real'; synthetic: { trips: number; deliveries: number; requests: number };
}

/** Public situation summary (landing page, no auth). */
export interface PublicSummary {
  generatedAt: string; places: number; people: number; inCrisis: number; critical: number; peopleInCrisis: number;
  newsReports: number; tankers: number; depots: number;
  /** [lng, lat, crisis 0-100, population] */
  points: [number, number, number, number][];
  criticalPlaces: { name: string; district: string; crisis: number }[];
  rainfall: { district: string; deviation: number; severity: string }[];
  headlines: { title: string; publisher: string; url: string; publishedAt: string | null; places: string[] }[];
}

/** First come first served vs JalSetu on the same request stream (GET /analytics/impact-replay). */
export interface StrategyResult {
  litresDelivered: number; litresTowardNeed: number; unmetLitres: number; unmetPct: number; requestsFullyServed: number;
  requestsStillWaiting: number | null; uniqueNeeds: number; medianWaitHours: number | null; avgWaitHours: number | null;
  fairnessJain: number | null; worstFifthCoveragePct: number | null; placesReached: number; placesTotal: number;
  vulnerablePlaces: number; vulnerablePlacesReached: number; vulnerableCoveragePct: number | null; trips: number; kmDriven: number;
  drivingHours: number; fuelLitres: number; fuelInr: number; co2Kg: number; loadUtilisationPct: number | null; litresPerKm: number | null;
  duplicateRequestsServed: number; litresOnDuplicates: number;
}
export interface ImpactReplay {
  windowDays: number; from: string; to: string; includeSynthetic: boolean; available: boolean; reason?: string;
  requests: { total: number; synthetic: number; real: number };
  fleet: { tankers: number; depots: number; tripsPerDay: number; shiftHours: number; speedKmh: number; stopMinutes: number; capacityLitres: number };
  needLitres?: number; places?: number;
  duplicates?: { requests: number; litresAsked: number; fcfsServedAgain: number; fcfsLitresOnRepeats: number; jalsetuMerged: number };
  fcfs?: StrategyResult; jalsetu?: StrategyResult;
  daily?: { date: string; requests: number; fcfsDelivered: number; jalsetuDelivered: number; fcfsCumulative: number; jalsetuCumulative: number; fcfsBacklog: number; jalsetuBacklog: number }[];
  coverageBands?: { band: string; fcfs: number; jalsetu: number }[];
  perPlace?: { communityId: string; name: string; priority: number; vulnerability: number; vulnerable: boolean; crisis: number; needLitres: number;
    requests: number; repeats: number; fcfsCoveragePct: number; jalsetuCoveragePct: number; fcfsFirstServedDay: number | null; jalsetuFirstServedDay: number | null }[];
  assumptions?: string[]; method?: string; generatedAt?: string;
}

export type ScheduleKind = 'tap' | 'standpost' | 'piped' | 'tanker_halt';
export interface TapSchedule {
  id: number; communityId: string; communityName: string; pointName: string; kind: ScheduleKind; days: number[]; daysLabel: string;
  startTime: string; endTime: string; lat: number | null; lng: number | null; notes: string; isActive: boolean; dataOrigin: DataOrigin;
  updatedBy: string; updatedAt: string;
  next: { startsAt: string; endsAt: string; running: boolean; startsLocal: string; endsLocal: string } | null;
}
export type NoticeKind = 'interruption' | 'extra_supply' | 'quality' | 'info';
export interface SupplyNotice { id: number; communityId: string; communityName: string; kind: NoticeKind; message: string; startsAt: string; endsAt: string | null; createdBy: string; createdAt: string }
export interface PublicSupply {
  community: { id: string; name: string; ward: string; district: string | null; state: string | null; population: number };
  schedules: TapSchedule[]; nextSupply: TapSchedule | null; notices: SupplyNotice[];
  tanker: { stage: 'scheduled' | 'on_the_way' | 'arrived'; trip: string; litres: number; since: string | null } | null;
  lastDelivery: { at: string; litres: number } | null; estimatedCoveragePct: number; coverageBasis: string; serverTime: string;
}

export interface ShortageAnalysis {
  windowDays: number; origin: 'all' | 'real';
  trend: { date: string; requests: number; repeats: number; citizen: number; litresRequested: number; litresDelivered: number }[];
  trendSummary: { last7: number; prev7: number; changePct: number | null; repeatsMerged: number; citizenRequests: number; syntheticIncluded: boolean };
  scope: { label: string; places: number; people: number; underserved: number };
  fleetCapacity: number;
  outlook: { days: { date: string; needP50: number; needP90: number; survival: number; capacity: number; gapP50: number; survivalMet: boolean }[]; source: string; note: string | null };
  coverOfNeedPct: number | null; shortageDays: number;
  underserved: { id: string; name: string; district: string | null; settlementType: string | null; population: number; coveragePct: number; shortfall: number;
    tankerNeed: number; delivered7d: number; lastDeliveryAt: string | null; daysSinceDelivery: number | null; openRequests: number; vulnerability: number;
    crisis: number; priority: number; topReason: string; underserved: boolean }[];
}
