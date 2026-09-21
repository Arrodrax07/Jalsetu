import React, { useState } from 'react';
import {
  Cpu,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sliders,
  TrendingUp,
  BarChart2,
  HelpCircle,
  Truck,
  ArrowRight
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';

export const Allocation: React.FC = () => {
  const {
    allocationPlan,
    fairnessBefore,
    fairnessAfter,
    runAllocation,
    isAllocationRunning,
    approveAllocation,
    simulateDisruption,
    restoreOriginalAllocation,
    isDisruptionActive,
    weights
  } = useWaterData();

  const [processingStage, setProcessingStage] = useState<string>('');

  const stages = [
    'Analyzing demand...',
    'Checking vulnerability...',
    'Reviewing previous allocations...',
    'Calculating unmet need...',
    'Optimizing fairness...',
    'Generating allocation plan...'
  ];

  const handleRunAllocation = async () => {
    let currentIdx = 0;
    const interval = setInterval(() => {
      if (currentIdx < stages.length) {
        setProcessingStage(stages[currentIdx]);
        currentIdx++;
      } else {
        clearInterval(interval);
      }
    }, 220);

    await runAllocation();
    clearInterval(interval);
    setProcessingStage('');
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-slate-900">
              Fair Allocation Engine
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200">
              Core Differentiator
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            The allocation engine prioritizes communities using demand, vulnerability, previous service coverage, population and unmet need.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {isDisruptionActive ? (
            <button
              onClick={restoreOriginalAllocation}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Clear Disruption</span>
            </button>
          ) : (
            <button
              onClick={simulateDisruption}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold shadow-sm transition-all"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Simulate Supply Disruption</span>
            </button>
          )}

          <button
            onClick={handleRunAllocation}
            disabled={isAllocationRunning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <Cpu className="w-4 h-4 text-sky-200" />
            <span>{isAllocationRunning ? 'Processing Engine...' : 'Run Allocation'}</span>
          </button>

          <button
            onClick={approveAllocation}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Approve Allocation</span>
          </button>
        </div>
      </div>

      {/* Dynamic Reallocation Simulation Notice */}
      {isDisruptionActive && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 shadow-subtle flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-scale-in">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-700 flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Dynamic Supply Disruption Active: 12,000 L Shortfall Detected
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Tanker <strong>T-2045</strong> reported mechanical failure on JVLR. JalSetu AI automatically recalculated quotas:
                Critical areas (Shivaji Nagar & Dharavi) remain <strong>100% protected</strong>, while low-vulnerability reserves absorbed the deficit.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap">
              Protected: Shivaji Nagar & Dharavi
            </span>
          </div>
        </div>
      )}

      {/* Animated Multi-Stage Processing Indicator */}
      {isAllocationRunning && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-sky-900 via-slate-900 to-sky-950 text-white shadow-elevated border border-sky-500/30 animate-pulse-subtle">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sky-400 animate-spin" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-sky-200">
                JalSetu AI Optimization in Progress
              </h3>
            </div>
            <span className="text-xs font-mono text-sky-300">Evaluating 10 Wards</span>
          </div>

          <p className="text-base font-black text-white tracking-wide mb-3">
            {processingStage || 'Analyzing demand...'}
          </p>

          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-400 to-emerald-400 rounded-full w-full animate-[pulse_1s_infinite]" />
          </div>
        </div>
      )}

      {/* Explainability & Fairness Improvement Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Why this allocation? (Factor weights breakdown) */}
        <div className="lg:col-span-2 p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-600" />
                Explainability Engine: Why This Allocation?
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Transparent multi-factor priority algorithm preventing arbitrary or biased water cuts.
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
              Active Parameters
            </span>
          </div>

          {/* 5 Factor Bars */}
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Community Water Demand Severity</span>
                <span className="text-sky-700 font-bold">{Math.round(weights.demand * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-sky-600 h-full rounded-full" style={{ width: `${weights.demand * 100}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Socioeconomic & Demographic Vulnerability</span>
                <span className="text-amber-700 font-bold">{Math.round(weights.vulnerability * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full" style={{ width: `${weights.vulnerability * 100}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Unmet Need & Consecutive Days Without Water</span>
                <span className="text-rose-700 font-bold">{Math.round(weights.unmetNeed * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-rose-500 h-full rounded-full" style={{ width: `${weights.unmetNeed * 100}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Previous Service Deficit / Coverage Gap</span>
                <span className="text-teal-700 font-bold">{Math.round(weights.previousCoverage * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-teal-500 h-full rounded-full" style={{ width: `${weights.previousCoverage * 100}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Total Impacted Population Size</span>
                <span className="text-indigo-700 font-bold">{Math.round(weights.population * 100)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${weights.population * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Allocation Balance Improvement Metric */}
        <div className="p-5 bg-gradient-to-br from-slate-900 to-sky-950 text-white rounded-2xl shadow-subtle flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-300">
                Allocation Balance Improved
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Before AI intervention, peripheral informal settlements suffered acute deficits while central wards monopolized municipal tankers.
            </p>
          </div>

          <div className="my-6 p-4 rounded-xl bg-white/10 border border-white/10 backdrop-blur-md">
            <div className="flex items-center justify-around text-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Before AI</p>
                <p className="text-3xl font-black text-rose-400 mt-1">{fairnessBefore}%</p>
                <span className="text-[10px] text-slate-400">High Disparity</span>
              </div>

              <div className="h-10 w-px bg-white/20" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">After JalSetu AI</p>
                <p className="text-3xl font-black text-emerald-400 mt-1">{fairnessAfter}%</p>
                <span className="text-[10px] text-emerald-300 font-semibold">+22% Equitable</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            City-wide Gini equality index normalized across 86,000+ residents.
          </p>
        </div>
      </div>

      {/* Allocation Plan Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            Recommended Resource Allocation Quotas
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            Total Water Demand: {allocationPlan.reduce((a, b) => a + b.demand, 0).toLocaleString()} L
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Community</th>
                <th className="px-4 py-3">Daily Demand</th>
                <th className="px-4 py-3">Current Available</th>
                <th className="px-4 py-3">Previous Allocation</th>
                <th className="px-4 py-3 text-center">Priority Score</th>
                <th className="px-4 py-3">Recommended Allocation</th>
                <th className="px-4 py-3">AI Justification & Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allocationPlan.map(item => {
                const isCritical = item.priorityScore >= 90;

                return (
                  <tr
                    key={item.communityId}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isCritical ? 'bg-rose-50/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        {isCritical && (
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
                        )}
                        <span>{item.communityName}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 font-medium text-slate-700">
                      {item.demand.toLocaleString()} L
                    </td>

                    <td className="px-4 py-3 text-slate-600">
                      {item.available.toLocaleString()} L
                    </td>

                    <td className="px-4 py-3 text-slate-500">
                      {item.previousAllocation.toLocaleString()} L
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-xs ${
                          item.priorityScore >= 90
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : item.priorityScore >= 75
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-sky-100 text-sky-800 border border-sky-200'
                        }`}
                      >
                        {item.priorityScore}
                      </span>
                    </td>

                    <td className="px-4 py-3 font-bold text-sky-700 text-sm">
                      {item.recommendedAllocation.toLocaleString()} L
                    </td>

                    <td className="px-4 py-3 text-slate-600 leading-relaxed max-w-sm">
                      {item.reason}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
