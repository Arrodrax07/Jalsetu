// Chart tokens for the dark operations surface (#0c121d).
// Categorical order is fixed; validated with the dataviz palette validator (dark mode: lightness band, chroma,
// CVD separation ΔE ≥ 22, normal-vision ΔE ≥ 30, contrast ≥ 3:1).
export const SERIES = ['#0284c7', '#d97706', '#8b5cf6'] as const;
export const REFERENCE = '#64748b';
export const GRID = '#1e2a3d';
export const AXIS_TICK = { fontSize: 11, fill: '#94a3bd' };

export const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: '1px solid #2e3e58', background: '#111927', fontSize: 12, color: '#e6edf6' },
  labelStyle: { fontWeight: 600, color: '#e6edf6' },
  itemStyle: { color: '#c7d2e2' },
};

export const kLitres = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
