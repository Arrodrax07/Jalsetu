import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
    isNeutral?: boolean;
    label?: string;
  };
  accentColor?: 'brand' | 'emerald' | 'amber' | 'rose' | 'cyan';
  onClick?: () => void;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor = 'brand',
  onClick
}) => {
  const colorMap = {
    brand: 'bg-brand-50 text-brand-600 border-brand-100 group-hover:border-brand-300',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:border-emerald-300',
    amber: 'bg-amber-50 text-amber-600 border-amber-100 group-hover:border-amber-300',
    rose: 'bg-rose-50 text-rose-600 border-rose-100 group-hover:border-rose-300',
    cyan: 'bg-cyan-50 text-cyan-600 border-cyan-100 group-hover:border-cyan-300',
  };

  return (
    <div
      onClick={onClick}
      className={`group relative bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle hover:shadow-card transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:border-slate-300' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{title}</p>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900">{value}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl border transition-colors ${colorMap[accentColor]}`}>
          {icon}
        </div>
      </div>

      {trend && (
        <div className="mt-3 flex items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
          {trend.isNeutral ? (
            <span className="font-semibold text-slate-600">{trend.value}</span>
          ) : trend.isPositive ? (
            <span className="inline-flex items-center font-semibold text-emerald-600">
              <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
              {trend.value}
            </span>
          ) : (
            <span className="inline-flex items-center font-semibold text-rose-600">
              <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
              {trend.value}
            </span>
          )}
          {trend.label && <span className="text-slate-400">{trend.label}</span>}
        </div>
      )}
    </div>
  );
};
