import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'urgency' | 'status' | 'vulnerability' | 'delivery';
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  let style = 'bg-slate-100 text-slate-700 border-slate-200';

  const lower = status.toLowerCase();

  if (lower === 'critical' || lower === 'very high' || lower === 'mismatch' || lower === 'maintenance' || lower === 'rejected') {
    style = 'bg-rose-50 text-rose-700 border-rose-200 font-medium';
  } else if (lower === 'high' || lower === 'high demand' || lower === 'under investigation' || lower === 'escalated' || lower === 'pending verification' || lower === 'proposed') {
    style = 'bg-amber-50 text-amber-700 border-amber-200 font-medium';
  } else if (lower === 'medium' || lower === 'allocated' || lower === 'en route' || lower === 'loading' || lower === 'dispatched' || lower === 'assigned') {
    style = 'bg-sky-50 text-sky-700 border-sky-200 font-medium';
  } else if (lower === 'verified' || lower === 'delivered' || lower === 'resolved' || lower === 'recently served' || lower === 'approved' || lower === 'completed') {
    style = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-medium';
  } else if (lower === 'low' || lower === 'normal' || lower === 'idle' || lower === 'pending') {
    style = 'bg-slate-50 text-slate-600 border-slate-200 font-medium';
  }

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center rounded-md border tracking-wide whitespace-nowrap ${padding} ${style}`}>
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-70" />
      {status}
    </span>
  );
};
