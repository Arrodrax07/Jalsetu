import React from 'react';
import {
  TrendingDown,
  TrendingUp,
  Percent,
  Compass,
  CheckCircle2,
  BarChart3,
  Layers,
  Info
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line
} from 'recharts';
import { FairnessLoopDiagram } from '../components/feedback/FairnessLoopDiagram';

export const ImpactAnalytics: React.FC = () => {
  // Before vs AI-Optimized Allocation Data from Problem Statement
  const beforeVsAfterData = [
    { area: 'Area A (Chembur)', Before: 70, After: 90 },
    { area: 'Area B (Kurla East)', Before: 40, After: 70 },
    { area: 'Area C (Govandi)', Before: 60, After: 85 },
    { area: 'Area D (Shivaji Nagar)', Before: 20, After: 60 },
    { area: 'Area E (Dharavi)', Before: 35, After: 75 }
  ];

  // Longitudinal Unmet Demand & Distance Trends
  const impactTrendsData = [
    { week: 'Week 1 (Manual)', unmetRequests: 88, avgDistanceKm: 28.4, duplicateGrievances: 42 },
    { week: 'Week 2 (Pilot)', unmetRequests: 74, avgDistanceKm: 24.1, duplicateGrievances: 34 },
    { week: 'Week 3 (AI Alpha)', unmetRequests: 58, avgDistanceKm: 21.0, duplicateGrievances: 25 },
    { week: 'Week 4 (JalSetu Full)', unmetRequests: 42, avgDistanceKm: 18.4, duplicateGrievances: 18 }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Civic Impact & Governance Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Quantifying municipal equity gains, transit decarbonization, and grievance deduplication.
          </p>
        </div>

        {/* Clear Disclaimer Tag Required by Problem Statement */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
          <Info className="w-4 h-4 text-amber-600" />
          <span>Projected Impact • Illustrative Demo Metrics</span>
        </div>
      </div>

      {/* 4 Core Projected Impact Indicator Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Unmet Requisitions</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-emerald-600">-28%</span>
              <TrendingDown className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Reduction in unserved water requests across informal settlements.</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Fleet Travel Distance</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-sky-600">-22%</span>
              <TrendingDown className="w-4 h-4 text-sky-600" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Reduction in total tanker mileage via TSP routing algorithms.</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Duplicate Complaints</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-amber-600">-35%</span>
              <TrendingDown className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Reduction in duplicate calls via AI grievance grouping.</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Coverage Equality Balance</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-emerald-600">+31%</span>
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Improvement in geographic water distribution fairness index.</p>
        </div>
      </div>

      {/* Core Comparative Chart: Before vs AI-Optimized Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Before vs AI-Optimized Allocation
            </h3>
            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Coverage %
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Demonstrates dramatic reduction in water starvation across historically underserved areas (Area D & E).
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={beforeVsAfterData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="area" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(value: any) => [`${value}% Coverage`]}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="Before" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Before AI (Manual)" />
                <Bar dataKey="After" fill="#0284c7" radius={[4, 4, 0, 0]} name="After JalSetu AI" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Longitudinal Optimization Trends */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Longitudinal Optimization Trajectory
            </h3>
            <span className="text-xs text-sky-600 font-bold bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
              Weekly Progression
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Systematic decline in unmet demand volume and average tanker transit distance.
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={impactTrendsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="unmetRequests" stroke="#ef4444" strokeWidth={2.5} name="Unmet Requests" />
                <Line type="monotone" dataKey="avgDistanceKm" stroke="#0284c7" strokeWidth={2.5} name="Avg Travel (km)" />
                <Line type="monotone" dataKey="duplicateGrievances" stroke="#f59e0b" strokeWidth={2} name="Duplicate Calls" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Fairness Feedback Loop Diagram (Section 19) */}
      <FairnessLoopDiagram />
    </div>
  );
};
