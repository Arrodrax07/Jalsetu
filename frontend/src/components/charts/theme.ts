// Chart tokens. Categorical order is fixed (validated with the dataviz palette validator: CVD ΔE ≥ 23).
export const SERIES = ['#0284c7', '#d97706', '#7c3aed'] as const;
export const REFERENCE = '#94a3b8'; // baselines / targets (neutral, not a series)
export const GRID = '#e2e8f0';
export const AXIS_TICK = { fontSize: 11, fill: '#64748b' };

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 10px 15px -3px rgba(15,23,42,.08)' },
  labelStyle: { fontWeight: 700, color: '#0f172a' },
  itemStyle: { color: '#334155' },
};

export const kLitres = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
