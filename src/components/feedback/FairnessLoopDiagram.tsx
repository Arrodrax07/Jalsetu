import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, RotateCw, FileText, Cpu, Truck, Database, ShieldCheck, Sparkles } from 'lucide-react';

export const FairnessLoopDiagram: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(1);

  const steps = [
    {
      step: 1,
      name: 'Requests',
      icon: FileText,
      tag: 'Demand Capture',
      detail: 'Aggregates requests, complaints, and public-tap telemetry from vulnerable urban communities.'
    },
    {
      step: 2,
      name: 'AI Allocation',
      icon: Cpu,
      tag: 'Equitable Optimization',
      detail: 'Computes priority scores combining demand, vulnerability, unmet need, and population weightings.'
    },
    {
      step: 3,
      name: 'Delivery',
      icon: Truck,
      tag: 'Optimized Routing',
      detail: 'Dispatches municipal tankers along shortest fuel-efficient routes to deliver allocated volume.'
    },
    {
      step: 4,
      name: 'Service Data',
      icon: Database,
      tag: 'IoT Telemetry & POD',
      detail: 'Captures GPS geofence timestamps, flow sensor discharge, and field officer digital verifications.'
    },
    {
      step: 5,
      name: 'Fairness Check',
      icon: ShieldCheck,
      tag: 'Variance & Bias Audit',
      detail: 'Audits delivery shortfalls and community feedback to detect underserved biases.'
    },
    {
      step: 6,
      name: 'Next Allocation',
      icon: Sparkles,
      tag: 'Adaptive Tuning',
      detail: 'Adjusts future community priority scores and tanker quotas to guarantee equitable city coverage.'
    }
  ];

  return (
    <div className="p-6 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
            <RotateCw className="w-4 h-4 text-sky-600 animate-spin-slow" />
            Fairness Feedback Loop Architecture
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            The platform continuously learns from delivery outcomes and community grievances to refine future allocations.
          </p>
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 self-start sm:self-auto">
          Closed-Loop Governance
        </span>
      </div>

      {/* Interactive Step Sequence */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {steps.map((s, idx) => {
          const Icon = s.icon;
          const isSelected = activeStep === s.step;

          return (
            <div
              key={s.step}
              onClick={() => setActiveStep(s.step)}
              className={`relative p-3.5 rounded-xl border transition-all cursor-pointer text-center group ${
                isSelected
                  ? 'bg-sky-50 border-sky-400 shadow-card ring-2 ring-sky-200'
                  : 'bg-slate-50/70 border-slate-200 hover:bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-center mb-2">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isSelected ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 group-hover:text-sky-600 shadow-sm'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Step {s.step}</span>
              <h4 className="text-xs font-bold text-slate-900 mt-0.5">{s.name}</h4>
              <p className="text-[10px] text-slate-500 mt-0.5">{s.tag}</p>

              {idx < steps.length - 1 && (
                <div className="hidden md:block absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Step Explanation Detail */}
      <div className="mt-4 p-4 rounded-xl bg-slate-900 text-white flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300">
            Phase {activeStep}: {steps[activeStep - 1].name} — {steps[activeStep - 1].tag}
          </h4>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            {steps[activeStep - 1].detail}
          </p>
        </div>
      </div>
    </div>
  );
};
