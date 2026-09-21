export type UrgencyLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type VulnerabilityLevel = 'Low' | 'Medium' | 'High' | 'Very High';
export type RequestStatus = 'Pending' | 'Allocated' | 'Dispatched' | 'Delivered' | 'Rejected';
export type ComplaintCategory = 
  | 'No Water'
  | 'Late Tanker'
  | 'Insufficient Quantity'
  | 'Poor Water Quality'
  | 'Missed Delivery'
  | 'Duplicate Request';
export type ComplaintStatus = 'Pending' | 'Escalated' | 'Assigned' | 'Resolved';
export type TankerStatus = 'Loading' | 'En Route' | 'Delivered' | 'Idle' | 'Maintenance';
export type DeliveryStatus = 'Verified' | 'Mismatch' | 'Under Investigation';
export type UserRole = 'admin' | 'officer' | 'demo';

export interface Community {
  id: string;
  name: string;
  ward: string;
  population: number;
  dailyDemand: number;        // Litres
  allocatedWater: number;     // Litres
  availableWater: number;     // Litres
  shortfall: number;          // Litres
  vulnerability: VulnerabilityLevel;
  vulnerabilityScore: number; // 0 - 100
  previousAllocation: number; // Litres
  currentCoverage: number;    // Percentage (0 - 100)
  lastDelivery: string;
  openComplaints: number;
  repeatedComplaints: number;
  priorityScore: number;      // 0 - 100
  lat: number;
  lng: number;
  status: 'Normal' | 'High Demand' | 'Critical' | 'Recently Served';
  contactOfficer: string;
  officerPhone: string;
}

export interface AIAssessment {
  demandLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedShortfall: number;
  priorityScore: number;
  reasoning: string;
}

export interface WaterRequest {
  id: string;
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
  aiAssessment?: AIAssessment;
}

export interface Complaint {
  id: string;
  communityId: string;
  communityName: string;
  category: ComplaintCategory;
  description: string;
  sentiment: 'Negative' | 'Neutral' | 'Critical';
  severity: UrgencyLevel;
  isRepeated: boolean;
  similarComplaintsCount: number;
  status: ComplaintStatus;
  assignedOfficer?: string;
  submittedAt: string;
  duplicateProbability: number;
  recommendedAction: string;
}

export interface Tanker {
  id: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  capacity: number;           // Litres
  currentLoad: number;        // Litres
  status: TankerStatus;
  currentLocationName: string;
  destinationCommunity: string;
  eta: string;
  speedKmH: number;
  progressPercent: number;
  currentCoordinates: [number, number];
  routeWaypoints: [number, number][];
  stops: string[];
  isDisrupted?: boolean;
}

export interface DeliveryRecord {
  id: string;
  tankerId: string;
  vehicleNumber: string;
  communityName: string;
  allocatedAmount: number;
  deliveredAmount: number;
  deliveryTime: string;
  gpsVerified: boolean;
  officerVerified: boolean;
  status: DeliveryStatus;
  varianceAmount: number;
  notes?: string;
  fieldOfficer: string;
}

export interface PriorityFactors {
  demand: number;             // percentage contribution
  vulnerability: number;
  unmetNeed: number;
  previousCoverage: number;
  population: number;
}

export interface AllocationPlanItem {
  communityId: string;
  communityName: string;
  demand: number;
  available: number;
  previousAllocation: number;
  priorityScore: number;
  recommendedAllocation: number;
  reason: string;
  status: 'Proposed' | 'Approved' | 'Dispatched';
  factors: PriorityFactors;
}

export interface PriorityWeights {
  demand: number;             // e.g. 0.35
  vulnerability: number;      // e.g. 0.30
  unmetNeed: number;          // e.g. 0.20
  previousCoverage: number;   // e.g. 0.10
  population: number;         // e.g. 0.05
}

export interface RouteOptimizationResult {
  tankerId: string;
  vehicleNumber: string;
  stops: string[];
  distanceBeforeKm: number;
  distanceAfterKm: number;
  distanceSavedKm: number;
  timeBeforeMin: number;
  timeAfterMin: number;
  timeSavedMin: number;
  fuelSavedInr: number;
  co2SavedKg: number;
  recommendedSequence: string[];
}
