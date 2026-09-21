import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Activity, AlertTriangle, TrendingUp, Filter, ShieldCheck, Droplet } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';

export const DemandAnalysis: React.FC = () => {
  const { communities } = useWaterData();
  const [timeFilter, setTimeFilter] = useState<'Today' | '7 Days' | '30 Days'>('Today');

  // Chart Data: Demand vs Supply
  const demandVsSupplyData = communities.map(c => ({
    name: c.name.split(' ')[0], // Compact label
    Demand: c.dailyDemand,
    Allocated: c.allocatedWater,
    Shortfall: c.shortfall
  }));

  // Shortfall ranking
  const shortfallRankingData = [...communities]
    .sort((a, b) => b.shortfall - a.shortfall)
    .slice(0, 7)
    .map(c => ({
      name: c.name,
      Shortfall: c.shortfall,
      Vulnerability: c.vulnerabilityScore
    }));

  // Vulnerability Distribution Pie Data
  const vulnCounts = {
    'Very High': communities.filter(c => c.vulnerability === 'Very High').length,
    'High': communities.filter(c => c.vulnerability === 'High').length,
    'Medium': communities.filter(c => c.vulnerability === 'Medium').length,
    'Low': communities.filter(c => c.vulnerability === 'Low').length
  };

  const pieData = [
    { name: 'Very High (Dharavi)', value: vulnCounts['Very High'], color: '#ef4444' },
    { name: 'High (Shivaji Nagar/Govandi)', value: vulnCounts['High'], color: '#f59e0b' },
    { name: 'Medium (Kurla/Vikhroli)', value: vulnCounts['Medium'], color: '#0284c7' },
    { name: 'Low (Sion/Wadala)', value: vulnCounts['Low'], color: '#10b981' }
  ];

  // Requests over time data
  const timeTrendsData = [
    { time: '06:00', requests: 12, volumeK: 75 },
    { time: '08:00', requests: 28, volumeK: 160 },
    { time: '10:00', requests: 45, volumeK: 290 },
    { time: '12:00', requests: 38, volumeK: 240 },
    { time: '14:00', requests: 22, volumeK: 140 },
    { time: '16:00', requests: 34, volumeK: 210 },
    { time: '18:00', requests: 19, volumeK: 110 }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Demand & Vulnerability Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Empirical telemetry on water requirements, acute shortfalls, and socioeconomic vulnerability indices.
          </p>
        </div>

        {/* Time Filter Buttons */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-subtle">
          {(['Today', '7 Days', '30 Days'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTimeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                timeFilter === t
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Top 3 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-subtle">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Gross City Demand</span>
            <Droplet className="w-4 h-4 text-sky-600" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-1">
            {communities.reduce((a, b) => a + b.dailyDemand, 0).toLocaleString()} L
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Across 86,120 estimated population</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-100 bg-rose-50/20 shadow-subtle">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Accumulated Shortfall</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <h3 className="text-2xl font-bold text-rose-600 mt-1">
            {communities.reduce((a, b) => a + b.shortfall, 0).toLocaleString()} L
          </h3>
          <p className="text-[11px] text-rose-500 mt-0.5">Concentrated in 4 high-vulnerability pockets</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-100 bg-emerald-50/20 shadow-subtle">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Mean Coverage Balance</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <h3 className="text-2xl font-bold text-emerald-700 mt-1">
            {Math.round(communities.reduce((a, b) => a + b.currentCoverage, 0) / communities.length)}%
          </h3>
          <p className="text-[11px] text-emerald-600 mt-0.5">Target minimum: 75% for all informal settlements</p>
        </div>
      </div>

      {/* Chart Row 1: Demand vs Supply & Shortfall Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Demand vs Allocated Bar Chart */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
            Daily Water Demand vs Allocated Supply
          </h3>
          <p className="text-xs text-slate-500 mb-4">Comparison of requirements against allocated tanker volume.</p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={demandVsSupplyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip
                  formatter={(value: any) => [`${Number(value).toLocaleString()} L`]}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="Demand" fill="#0284c7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Allocated" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Shortfall Ranking */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
            Critical Shortfall by Community
          </h3>
          <p className="text-xs text-slate-500 mb-4">Highest unmet daily liters requiring emergency dispatch.</p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shortfallRankingData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v / 1000}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip
                  formatter={(value: any) => [`${Number(value).toLocaleString()} L Shortfall`]}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Bar dataKey="Shortfall" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Chart Row 2: Vulnerability Distribution & Requisition Temporal Profile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vulnerability Distribution (Pie) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
            Vulnerability Distribution
          </h3>
          <p className="text-xs text-slate-500 mb-2">Ward categorization based on civic indices.</p>
          <div className="h-56 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
            {pieData.map(p => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-slate-600">{p.name}</span>
                </div>
                <span className="font-bold text-slate-800">{p.value} Wards</span>
              </div>
            ))}
          </div>
        </div>

        {/* Requests & Volume Over Time (2 Columns) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
            Hourly Requisition & Dispatched Volume Profile
          </h3>
          <p className="text-xs text-slate-500 mb-4">Tracking peak requisition windows during morning & evening cycles.</p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeTrendsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}kL`} />
                <Tooltip
                  formatter={(value: any, name: any) => [
                    name === 'volumeK' ? `${value}k Litres` : `${value} Requests`,
                    name === 'volumeK' ? 'Total Water' : 'Request Count'
                  ]}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="volumeK" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorVolume)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
