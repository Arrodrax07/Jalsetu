import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Community,
  WaterRequest,
  Complaint,
  Tanker,
  DeliveryRecord,
  AllocationPlanItem,
  PriorityWeights,
  UserRole,
  RequestStatus,
  ComplaintStatus,
  TankerStatus
} from '../types';
import { INITIAL_COMMUNITIES } from '../data/seededCommunities';
import { INITIAL_REQUESTS } from '../data/seededRequests';
import { INITIAL_COMPLAINTS } from '../data/seededComplaints';
import { INITIAL_TANKERS } from '../data/seededTankers';
import { INITIAL_DELIVERIES } from '../data/seededDeliveries';
import { DEFAULT_WEIGHTS, runFairAllocation, simulateDisruptionReallocation } from '../services/allocationEngine';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
}

export interface UserProfile {
  name: string;
  email: string;
  role: UserRole;
  designation: string;
  ward: string;
}

interface WaterDataContextType {
  // State
  currentUser: UserProfile | null;
  activeTab: string;
  communities: Community[];
  requests: WaterRequest[];
  complaints: Complaint[];
  tankers: Tanker[];
  deliveries: DeliveryRecord[];
  allocationPlan: AllocationPlanItem[];
  fairnessBefore: number;
  fairnessAfter: number;
  isAllocationRunning: boolean;
  isDisruptionActive: boolean;
  weights: PriorityWeights;
  selectedCommunity: Community | null;
  isPitchModeActive: boolean;
  pitchStep: number;
  toasts: ToastItem[];

  // Mutations
  login: (role: UserRole) => void;
  logout: () => void;
  setActiveTab: (tab: string) => void;
  setSelectedCommunity: (comm: Community | null) => void;
  createRequest: (newReq: Omit<WaterRequest, 'id' | 'submittedAt'>) => void;
  updateRequestStatus: (id: string, status: RequestStatus) => void;
  createComplaint: (newComp: Omit<Complaint, 'id' | 'submittedAt'>) => void;
  updateComplaintStatus: (id: string, status: ComplaintStatus) => void;
  runAllocation: () => Promise<void>;
  approveAllocation: () => void;
  simulateDisruption: () => void;
  restoreOriginalAllocation: () => void;
  dispatchTanker: (tankerId: string) => void;
  verifyDelivery: (deliveryId: string) => void;
  investigateDelivery: (deliveryId: string) => void;
  setWeights: (newWeights: PriorityWeights) => void;
  resetDemoData: () => void;
  startPitchMode: () => void;
  stopPitchMode: () => void;
  setPitchStep: (step: number) => void;
  nextPitchStep: () => void;
  prevPitchStep: () => void;
  addToast: (title: string, message: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
}

const WaterDataContext = createContext<WaterDataContextType | undefined>(undefined);

const STORAGE_KEYS = {
  COMMUNITIES: 'jalsetu_communities_v1',
  REQUESTS: 'jalsetu_requests_v1',
  COMPLAINTS: 'jalsetu_complaints_v1',
  TANKERS: 'jalsetu_tankers_v1',
  DELIVERIES: 'jalsetu_deliveries_v1',
  WEIGHTS: 'jalsetu_weights_v1',
  USER: 'jalsetu_user_v1'
};

export const WaterDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load initial from localStorage or seeded
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USER);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    // Default logged in as Administrator for seamless pitching demo
    return {
      name: 'Aditi Sharma, IAS',
      email: 'aditi.sharma@jalsetu.gov.in',
      role: 'admin',
      designation: 'Municipal Water Commissioner',
      ward: 'Greater Mumbai Municipal Corporation'
    };
  });

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);

  const [communities, setCommunities] = useState<Community[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COMMUNITIES);
    return saved ? JSON.parse(saved) : INITIAL_COMMUNITIES;
  });

  const [requests, setRequests] = useState<WaterRequest[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.REQUESTS);
    return saved ? JSON.parse(saved) : INITIAL_REQUESTS;
  });

  const [complaints, setComplaints] = useState<Complaint[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COMPLAINTS);
    return saved ? JSON.parse(saved) : INITIAL_COMPLAINTS;
  });

  const [tankers, setTankers] = useState<Tanker[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TANKERS);
    return saved ? JSON.parse(saved) : INITIAL_TANKERS;
  });

  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DELIVERIES);
    return saved ? JSON.parse(saved) : INITIAL_DELIVERIES;
  });

  const [weights, setWeightsState] = useState<PriorityWeights>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.WEIGHTS);
    return saved ? JSON.parse(saved) : DEFAULT_WEIGHTS;
  });

  // Allocation plan
  const [allocationPlan, setAllocationPlan] = useState<AllocationPlanItem[]>(() => {
    return runFairAllocation(INITIAL_COMMUNITIES, DEFAULT_WEIGHTS).plan;
  });
  const [fairnessBefore, setFairnessBefore] = useState<number>(62);
  const [fairnessAfter, setFairnessAfter] = useState<number>(84);
  const [isAllocationRunning, setIsAllocationRunning] = useState<boolean>(false);
  const [isDisruptionActive, setIsDisruptionActive] = useState<boolean>(false);

  // Pitch mode
  const [isPitchModeActive, setIsPitchModeActive] = useState<boolean>(false);
  const [pitchStep, setPitchStepState] = useState<number>(1);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COMMUNITIES, JSON.stringify(communities));
  }, [communities]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(requests));
  }, [requests]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COMPLAINTS, JSON.stringify(complaints));
  }, [complaints]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TANKERS, JSON.stringify(tankers));
  }, [tankers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DELIVERIES, JSON.stringify(deliveries));
  }, [deliveries]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WEIGHTS, JSON.stringify(weights));
  }, [weights]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(STORAGE_KEYS.USER);
    }
  }, [currentUser]);

  // Toast helper
  const addToast = (title: string, message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Login / Logout
  const login = (role: UserRole) => {
    if (role === 'admin') {
      setCurrentUser({
        name: 'Aditi Sharma, IAS',
        email: 'aditi.sharma@jalsetu.gov.in',
        role: 'admin',
        designation: 'Municipal Water Commissioner',
        ward: 'Greater Mumbai Municipal Corporation'
      });
      addToast('Welcome Back', 'Logged in as Administrator (Municipal Commissioner)', 'success');
    } else if (role === 'officer') {
      setCurrentUser({
        name: 'Rajesh Patil',
        email: 'rajesh.patil@jalnigam.gov.in',
        role: 'officer',
        designation: 'Senior Ward Water Officer',
        ward: 'M/East Ward (Shivaji Nagar / Govandi)'
      });
      addToast('Field Portal Active', 'Logged in as Field Officer (M/East Ward)', 'info');
    } else {
      setCurrentUser({
        name: 'Hackathon Evaluator',
        email: 'demo@ecoders.org',
        role: 'demo',
        designation: 'Civic-Tech Pitch Reviewer',
        ward: 'Mumbai Urban Command Center'
      });
      addToast('Pitch Mode Ready', 'Interactive Demo Mode enabled for hackathon presentation', 'success');
    }
    setActiveTab('dashboard');
  };

  const logout = () => {
    setCurrentUser(null);
    addToast('Logged Out', 'Demo session ended', 'info');
  };

  // Create Request
  const createRequest = (newReq: Omit<WaterRequest, 'id' | 'submittedAt'>) => {
    const nextId = `WR-${1039 + requests.length}`;
    const fullRequest: WaterRequest = {
      ...newReq,
      id: nextId,
      submittedAt: 'Just now'
    };

    setRequests(prev => [fullRequest, ...prev]);

    // Update community stats
    setCommunities(prev => prev.map(c => {
      if (c.id === fullRequest.communityId) {
        return {
          ...c,
          openComplaints: c.openComplaints + 1,
          status: fullRequest.urgency === 'Critical' ? 'Critical' : c.status
        };
      }
      return c;
    }));

    addToast('Water Request Created', `Request ${nextId} submitted successfully and evaluated by JalSetu AI.`, 'success');
  };

  const updateRequestStatus = (id: string, status: RequestStatus) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    addToast('Request Updated', `Request ${id} status set to ${status}.`, 'info');
  };

  // Create Complaint
  const createComplaint = (newComp: Omit<Complaint, 'id' | 'submittedAt'>) => {
    const nextId = `C-${2051 + complaints.length}`;
    const fullComp: Complaint = {
      ...newComp,
      id: nextId,
      submittedAt: 'Just now'
    };

    setComplaints(prev => [fullComp, ...prev]);
    addToast('Complaint Registered', `Grievance ticket ${nextId} classified and queued.`, 'info');
  };

  const updateComplaintStatus = (id: string, status: ComplaintStatus) => {
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    addToast('Grievance Updated', `Ticket ${id} marked as ${status}.`, 'success');
  };

  // Run Allocation
  const runAllocation = async () => {
    setIsAllocationRunning(true);
    setIsDisruptionActive(false);

    // Simulate multi-step processing time for realism
    await new Promise(resolve => setTimeout(resolve, 1400));

    const { plan, fairnessBefore: fb, fairnessAfter: fa } = runFairAllocation(communities, weights);
    setAllocationPlan(plan);
    setFairnessBefore(fb);
    setFairnessAfter(fa);
    setIsAllocationRunning(false);

    addToast('Fair Allocation Generated', 'AI prioritized high-vulnerability communities and improved coverage balance to 84%.', 'success');
  };

  const approveAllocation = () => {
    // Apply recommended allocations to communities
    setCommunities(prev => prev.map(comm => {
      const planItem = allocationPlan.find(p => p.communityId === comm.id);
      if (planItem) {
        const newAlloc = planItem.recommendedAllocation;
        const newCoverage = Math.min(100, Math.round((newAlloc / comm.dailyDemand) * 100));
        const newShortfall = Math.max(0, comm.dailyDemand - newAlloc);
        return {
          ...comm,
          allocatedWater: newAlloc,
          currentCoverage: newCoverage,
          shortfall: newShortfall,
          status: newCoverage >= 90 ? 'Recently Served' : (newCoverage >= 75 ? 'Normal' : 'High Demand')
        };
      }
      return comm;
    }));

    // Mark pending requests as Allocated
    setRequests(prev => prev.map(req => {
      if (req.status === 'Pending') {
        return { ...req, status: 'Allocated' };
      }
      return req;
    }));

    // Update plan status
    setAllocationPlan(prev => prev.map(p => ({ ...p, status: 'Approved' })));

    addToast('Allocation Approved & Dispatched', 'Water quotas updated across municipal wards and dispatch orders queued.', 'success');
  };

  // Disruption simulation
  const simulateDisruption = () => {
    const { revisedPlan, message } = simulateDisruptionReallocation(allocationPlan, 12000, 'T-2045');
    setAllocationPlan(revisedPlan);
    setIsDisruptionActive(true);

    // Flag Tanker T-2045 as disrupted
    setTankers(prev => prev.map(t => {
      if (t.id === 'T-2045') {
        return {
          ...t,
          status: 'Maintenance',
          isDisrupted: true,
          currentLocationName: 'Breakdown on JVLR near Kanjurmarg (Axle Leak)'
        };
      }
      return t;
    }));

    addToast('Disruption Reallocation Triggered', message, 'warning');
  };

  const restoreOriginalAllocation = () => {
    const { plan } = runFairAllocation(communities, weights);
    setAllocationPlan(plan);
    setIsDisruptionActive(false);

    setTankers(prev => prev.map(t => {
      if (t.id === 'T-2045') {
        return {
          ...t,
          status: 'En Route',
          isDisrupted: false,
          currentLocationName: 'Eastern Express Hwy near Ghatkopar'
        };
      }
      return t;
    }));

    addToast('Fleet Restored', 'Disruption cleared and baseline allocation reinstated.', 'success');
  };

  // Dispatch tanker
  const dispatchTanker = (tankerId: string) => {
    setTankers(prev => prev.map(t => {
      if (t.id === tankerId) {
        return {
          ...t,
          status: 'En Route',
          speedKmH: 32,
          eta: '18 min'
        };
      }
      return t;
    }));

    // Update related requests
    setRequests(prev => prev.map(r => {
      if (r.communityName === 'Shivaji Nagar' && r.status === 'Allocated') {
        return { ...r, status: 'Dispatched' };
      }
      return r;
    }));

    addToast('Tanker Dispatched', `Tanker ${tankerId} dispatched along AI-optimized route. Telemetry live.`, 'success');
  };

  // Verify delivery
  const verifyDelivery = (deliveryId: string) => {
    setDeliveries(prev => prev.map(d => {
      if (d.id === deliveryId) {
        return {
          ...d,
          status: 'Verified',
          officerVerified: true,
          notes: 'Field officer digital sign-off and IoT ultrasonic sensor audit completed successfully.'
        };
      }
      return d;
    }));
    addToast('Delivery Verified', `Proof-of-delivery for ${deliveryId} officially verified.`, 'success');
  };

  const investigateDelivery = (deliveryId: string) => {
    setDeliveries(prev => prev.map(d => {
      if (d.id === deliveryId) {
        return {
          ...d,
          status: 'Under Investigation',
          notes: 'Discrepancy inspection flagged to Ward Vigilance & Sensor Maintenance Team.'
        };
      }
      return d;
    }));
    addToast('Investigation Initiated', `Audit ticket generated for delivery ${deliveryId}.`, 'warning');
  };

  // Weights change
  const setWeights = (newWeights: PriorityWeights) => {
    setWeightsState(newWeights);
    const { plan } = runFairAllocation(communities, newWeights);
    setAllocationPlan(plan);
    addToast('Weights Updated', 'AI allocation parameters recalibrated.', 'info');
  };

  // Reset demo
  const resetDemoData = () => {
    localStorage.removeItem(STORAGE_KEYS.COMMUNITIES);
    localStorage.removeItem(STORAGE_KEYS.REQUESTS);
    localStorage.removeItem(STORAGE_KEYS.COMPLAINTS);
    localStorage.removeItem(STORAGE_KEYS.TANKERS);
    localStorage.removeItem(STORAGE_KEYS.DELIVERIES);
    localStorage.removeItem(STORAGE_KEYS.WEIGHTS);

    setCommunities(INITIAL_COMMUNITIES);
    setRequests(INITIAL_REQUESTS);
    setComplaints(INITIAL_COMPLAINTS);
    setTankers(INITIAL_TANKERS);
    setDeliveries(INITIAL_DELIVERIES);
    setWeightsState(DEFAULT_WEIGHTS);
    setAllocationPlan(runFairAllocation(INITIAL_COMMUNITIES, DEFAULT_WEIGHTS).plan);
    setIsDisruptionActive(false);

    addToast('Demo State Reset', 'Fresh seeded Mumbai urban dataset reloaded.', 'success');
  };

  // Pitch mode navigation
  const startPitchMode = () => {
    setIsPitchModeActive(true);
    setPitchStepState(1);
    setActiveTab('dashboard');
    addToast('Pitch Tour Started', 'Step 1 of 11: Follow the guided story for hackathon judges.', 'info');
  };

  const stopPitchMode = () => {
    setIsPitchModeActive(false);
  };

  const setPitchStep = (step: number) => {
    setPitchStepState(step);
    // Automatic tab switching to match step story
    if (step === 1) {
      setActiveTab('dashboard');
      // Highlight Shivaji Nagar
      const sn = communities.find(c => c.name === 'Shivaji Nagar');
      if (sn) setSelectedCommunity(sn);
    } else if (step === 2) {
      setActiveTab('requests');
    } else if (step === 3) {
      setActiveTab('requests');
    } else if (step === 4 || step === 5 || step === 6) {
      setActiveTab('allocation');
    } else if (step === 7 || step === 8) {
      setActiveTab('routeOptimizer');
    } else if (step === 9) {
      setActiveTab('tracking');
    } else if (step === 10) {
      setActiveTab('deliveryVerification');
    } else if (step === 11) {
      setActiveTab('impactAnalytics');
    }
  };

  const nextPitchStep = () => {
    if (pitchStep < 11) {
      setPitchStep(pitchStep + 1);
    } else {
      stopPitchMode();
      addToast('Pitch Complete!', 'All 11 story steps successfully demonstrated.', 'success');
    }
  };

  const prevPitchStep = () => {
    if (pitchStep > 1) {
      setPitchStep(pitchStep - 1);
    }
  };

  return (
    <WaterDataContext.Provider
      value={{
        currentUser,
        activeTab,
        communities,
        requests,
        complaints,
        tankers,
        deliveries,
        allocationPlan,
        fairnessBefore,
        fairnessAfter,
        isAllocationRunning,
        isDisruptionActive,
        weights,
        selectedCommunity,
        isPitchModeActive,
        pitchStep,
        toasts,
        login,
        logout,
        setActiveTab,
        setSelectedCommunity,
        createRequest,
        updateRequestStatus,
        createComplaint,
        updateComplaintStatus,
        runAllocation,
        approveAllocation,
        simulateDisruption,
        restoreOriginalAllocation,
        dispatchTanker,
        verifyDelivery,
        investigateDelivery,
        setWeights,
        resetDemoData,
        startPitchMode,
        stopPitchMode,
        setPitchStep,
        nextPitchStep,
        prevPitchStep,
        addToast,
        removeToast
      }}
    >
      {children}
    </WaterDataContext.Provider>
  );
};

export const useWaterData = () => {
  const context = useContext(WaterDataContext);
  if (!context) {
    throw new Error('useWaterData must be used within a WaterDataProvider');
  }
  return context;
};
