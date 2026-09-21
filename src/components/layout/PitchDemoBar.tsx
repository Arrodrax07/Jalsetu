import React from 'react';
import { Sparkles, ChevronLeft, ChevronRight, X, PlayCircle, CheckCircle } from 'lucide-react';
import { useWaterData } from '../../context/WaterDataContext';

export const PITCH_STEPS = [
  {
    step: 1,
    title: 'Identify Underserved Community',
    tab: 'dashboard',
    description: 'Map identifies Shivaji Nagar (Pop: 8,420) with 22,000 L acute shortfall and Priority Score 91/100.',
    actionLabel: 'Inspect Shivaji Nagar'
  },
  {
    step: 2,
    title: 'Review Critical Water Request',
    tab: 'requests',
    description: 'Request WR-1024 filed due to feeder pipeline rupture with local clinic and 8,420 residents impacted.',
    actionLabel: 'View Request WR-1024'
  },
  {
    step: 3,
    title: 'AI Assessment & Priority Scoring',
    tab: 'requests',
    description: 'JalSetu AI calculates 91 Priority Score combining demand severity, vulnerability, and 3 duplicate complaints.',
    actionLabel: 'Create / Test AI Request'
  },
  {
    step: 4,
    title: 'Open Fair Allocation Engine',
    tab: 'allocation',
    description: 'Evaluates 10 municipal wards simultaneously to balance high-risk informal settlements against city reserves.',
    actionLabel: 'View Allocation Engine'
  },
  {
    step: 5,
    title: 'Run AI Resource Allocation',
    tab: 'allocation',
    description: 'Simulate the multi-factor optimization engine to recommend 55,000 L emergency quota for Shivaji Nagar.',
    actionLabel: 'Run Allocation Simulation'
  },
  {
    step: 6,
    title: 'Explainable AI Breakdown',
    tab: 'allocation',
    description: 'Inspect transparent mathematical factors (Demand 35%, Vulnerability 30%, Unmet Need 20%) & fairness jump (62% → 84%).',
    actionLabel: 'Approve & Commit Allocation'
  },
  {
    step: 7,
    title: 'Optimize Tanker Route',
    tab: 'routeOptimizer',
    description: 'Optimize multi-stop delivery (Shivaji Nagar → Kurla East → Dharavi). Saves 7.2 km (28%) and 16 min travel time.',
    actionLabel: 'Calculate Route Savings'
  },
  {
    step: 8,
    title: 'Dispatch Tanker T-2045',
    tab: 'routeOptimizer',
    description: 'Dispatch 10,000 L capacity tanker MH-01-WT-2045 with live cellular/GPS telemetry link.',
    actionLabel: 'Dispatch Tanker'
  },
  {
    step: 9,
    title: 'Live GPS Telemetry & Tracking',
    tab: 'tracking',
    description: 'Watch real-time moving tanker marker navigating through Eastern Express corridor toward Shivaji Nagar.',
    actionLabel: 'Track Active Tankers'
  },
  {
    step: 10,
    title: 'Proof-of-Delivery Verification',
    tab: 'deliveryVerification',
    description: 'Audit digital geofence & IoT flow sensors. Detect variance alerts (e.g. 5,000 L shortage flagged for investigation).',
    actionLabel: 'Audit Delivery Records'
  },
  {
    step: 11,
    title: 'Impact Analytics & Feedback Loop',
    tab: 'impactAnalytics',
    description: 'Inspect projected civic outcomes: -28% unmet requests, +31% coverage balance, and automated Fairness Feedback Loop.',
    actionLabel: 'Review Impact Dashboard'
  }
];

export const PitchDemoBar: React.FC = () => {
  const {
    isPitchModeActive,
    pitchStep,
    setPitchStep,
    nextPitchStep,
    prevPitchStep,
    stopPitchMode,
    runAllocation,
    approveAllocation,
    dispatchTanker
  } = useWaterData();

  if (!isPitchModeActive) return null;

  const current = PITCH_STEPS[pitchStep - 1];

  const handleStepAction = () => {
    if (pitchStep === 5) {
      runAllocation();
    } else if (pitchStep === 6) {
      approveAllocation();
    } else if (pitchStep === 8) {
      dispatchTanker('T-2045');
    }
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white border-b border-sky-500/30 shadow-elevated sticky top-0 z-40 transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Step Indicator & Title */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-500 text-white font-bold text-xs shadow-glow">
            {pitchStep}/11
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Hackathon Pitch Tour
              </span>
              <span className="text-xs text-slate-400">•</span>
              <h4 className="text-sm font-bold text-white tracking-wide">{current.title}</h4>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 line-clamp-1 max-w-2xl">{current.description}</p>
          </div>
        </div>

        {/* Step dots & Controls */}
        <div className="flex items-center justify-between w-full md:w-auto gap-4">
          {/* Visual dots */}
          <div className="hidden lg:flex items-center gap-1">
            {PITCH_STEPS.map((s) => (
              <button
                key={s.step}
                onClick={() => setPitchStep(s.step)}
                title={`Step ${s.step}: ${s.title}`}
                className={`h-2 rounded-full transition-all ${
                  s.step === pitchStep
                    ? 'w-6 bg-sky-400'
                    : s.step < pitchStep
                    ? 'w-2 bg-emerald-400'
                    : 'w-2 bg-slate-600 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>

          {/* Action Button */}
          {current.actionLabel && (
            <button
              onClick={handleStepAction}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/30 text-xs font-semibold transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              {current.actionLabel}
            </button>
          )}

          {/* Stepper Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={prevPitchStep}
              disabled={pitchStep === 1}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Previous Step"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextPitchStep}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs transition-colors shadow-sm"
            >
              {pitchStep === 11 ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" /> Finish Tour
                </>
              ) : (
                <>
                  Next <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
            <button
              onClick={stopPitchMode}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors ml-1"
              title="Close Pitch Bar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
