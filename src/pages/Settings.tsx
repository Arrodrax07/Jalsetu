import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Sliders,
  RotateCcw,
  Save,
  Bell,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { PriorityWeights } from '../types';

export const Settings: React.FC = () => {
  const { weights, setWeights, resetDemoData, addToast } = useWaterData();

  // Local state for sliders
  const [demandW, setDemandW] = useState<number>(Math.round(weights.demand * 100));
  const [vulnW, setVulnW] = useState<number>(Math.round(weights.vulnerability * 100));
  const [unmetW, setUnmetW] = useState<number>(Math.round(weights.unmetNeed * 100));
  const [coverageW, setCoverageW] = useState<number>(Math.round(weights.previousCoverage * 100));
  const [popW, setPopW] = useState<number>(Math.round(weights.population * 100));

  const totalSum = demandW + vulnW + unmetW + coverageW + popW;

  const handleSaveWeights = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalSum !== 100) {
      addToast('Weight Calibration Alert', `Total weight sum must equal 100%. Current total: ${totalSum}%.`, 'warning');
      return;
    }

    const newWeights: PriorityWeights = {
      demand: demandW / 100,
      vulnerability: vulnW / 100,
      unmetNeed: unmetW / 100,
      previousCoverage: coverageW / 100,
      population: popW / 100
    };

    setWeights(newWeights);
    addToast('Weights Saved', 'JalSetu AI scoring algorithm recalibrated across all wards.', 'success');
  };

  const handleResetDefaults = () => {
    setDemandW(35);
    setVulnW(30);
    setUnmetW(20);
    setCoverageW(10);
    setPopW(5);

    setWeights({
      demand: 0.35,
      vulnerability: 0.30,
      unmetNeed: 0.20,
      previousCoverage: 0.10,
      population: 0.05
    });
    addToast('Weights Restored', 'Baseline weights (35/30/20/10/5) reinstated.', 'info');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            System Calibration & Governance Parameters
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Fine-tune mathematical fairness weights, fleet reserve tolerances, and reset demo datasets.
          </p>
        </div>

        <button
          onClick={resetDemoData}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold shadow-sm transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset Demo Data</span>
        </button>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editable Priority Weights Form (2 Columns) */}
        <div className="lg:col-span-2 p-6 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-600" />
                Fair Allocation Priority Weights
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Adjust the relative mathematical significance for each dimension in the AI priority equation.
              </p>
            </div>

            <div className={`px-3 py-1 rounded-full text-xs font-bold ${
              totalSum === 100
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              Sum: {totalSum}% {totalSum === 100 ? '✓' : '(Must be 100%)'}
            </div>
          </div>

          <form onSubmit={handleSaveWeights} className="space-y-5 text-xs">
            {/* 1. Demand Weight */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-700">
                <span>1. Community Demand Severity Weight</span>
                <span className="text-sky-700 font-bold">{demandW}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="60"
                value={demandW}
                onChange={(e) => setDemandW(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600"
              />
              <p className="text-[11px] text-slate-400">Scale factor evaluating daily gross water requirements.</p>
            </div>

            {/* 2. Vulnerability Weight */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-700">
                <span>2. Socioeconomic Vulnerability Index</span>
                <span className="text-amber-700 font-bold">{vulnW}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                value={vulnW}
                onChange={(e) => setVulnW(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <p className="text-[11px] text-slate-400">Protects informal settlements, hospitals, and low-income pockets.</p>
            </div>

            {/* 3. Unmet Need */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-700">
                <span>3. Unmet Need & Shortfall Duration</span>
                <span className="text-rose-700 font-bold">{unmetW}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                value={unmetW}
                onChange={(e) => setUnmetW(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
              <p className="text-[11px] text-slate-400">Penalizes prolonged water cuts (e.g. 3+ days dry pipeline).</p>
            </div>

            {/* 4. Previous Coverage */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-700">
                <span>4. Historical Coverage Deficit</span>
                <span className="text-teal-700 font-bold">{coverageW}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={coverageW}
                onChange={(e) => setCoverageW(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-teal-500"
              />
              <p className="text-[11px] text-slate-400">Gives priority to wards that received below average quotas yesterday.</p>
            </div>

            {/* 5. Population */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-700">
                <span>5. Population Density Contribution</span>
                <span className="text-indigo-700 font-bold">{popW}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={popW}
                onChange={(e) => setPopW(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <p className="text-[11px] text-slate-400">Normalizes quota allocation per capita.</p>
            </div>

            {/* Save Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
              >
                Reset to Recommended Baseline
              </button>

              <button
                type="submit"
                disabled={totalSum !== 100}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold shadow-card transition-all"
              >
                <Save className="w-4 h-4" />
                <span>Save & Recalibrate Engine</span>
              </button>
            </div>
          </form>
        </div>

        {/* System & Fleet Metadata (1 Column) */}
        <div className="space-y-4 text-xs">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-subtle space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-600" />
              Platform Configuration
            </h4>

            <div className="space-y-2">
              <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex justify-between">
                <span className="text-slate-500">Platform Identity:</span>
                <span className="font-bold text-slate-800">JalSetu AI v1.0</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex justify-between">
                <span className="text-slate-500">Team:</span>
                <span className="font-bold text-slate-800">Ecoders (PS 11)</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex justify-between">
                <span className="text-slate-500">Target Region:</span>
                <span className="font-bold text-slate-800">Greater Mumbai Suburbs</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex justify-between">
                <span className="text-slate-500">Active Depot:</span>
                <span className="font-bold text-slate-800">Chembur Central Hub A</span>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 text-white shadow-card space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Hackathon Demo Reset
            </h4>
            <p className="text-slate-300 leading-relaxed">
              Performed custom testing? Restore all 10 communities, 15 requests, 10 complaints, and 8 tankers to the pristine scenario state anytime.
            </p>
            <button
              onClick={resetDemoData}
              className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors shadow-sm"
            >
              Restore Pristine Demo State
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
