import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useWaterData } from '../../context/WaterDataContext';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useWaterData();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map(toast => {
        let icon = <Info className="w-5 h-5 text-sky-500" />;
        let borderClass = 'border-sky-200 bg-sky-50/95';
        
        if (toast.type === 'success') {
          icon = <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
          borderClass = 'border-emerald-200 bg-emerald-50/95';
        } else if (toast.type === 'warning') {
          icon = <AlertTriangle className="w-5 h-5 text-amber-600" />;
          borderClass = 'border-amber-200 bg-amber-50/95';
        } else if (toast.type === 'error') {
          icon = <AlertCircle className="w-5 h-5 text-rose-600" />;
          borderClass = 'border-rose-200 bg-rose-50/95';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-elevated backdrop-blur-md transition-all duration-300 transform translate-y-0 ${borderClass}`}
          >
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-slate-900">{toast.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 text-slate-400 hover:text-slate-600 p-1 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
