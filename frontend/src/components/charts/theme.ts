// Chart tokens. Categorical order is fixed: water blue, ochre, plum (distinct in hue and lightness, separable with
// deuteranopia / protanopia, >= 3:1 on both themes). Grid, axis and tooltip colours follow the theme through CSS
// (see .recharts-* rules in index.css), so charts need no theme logic of their own.
export const SERIES = ['#1478a8', '#c28a12', '#8a62c4'] as const;
export const REFERENCE = '#8796a2';
export const GRID = 'rgb(128 140 150 / .25)';
export const AXIS_TICK = { fontSize: 11, fill: '#808c96' };

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid rgb(var(--cc-border))', background: 'rgb(var(--cc-surface))', fontSize: 12, color: 'rgb(var(--cc-text))',
    boxShadow: '0 16px 32px -16px rgb(var(--cc-shadow) / .45)', padding: '8px 12px' },
  labelStyle: { fontWeight: 600, color: 'rgb(var(--cc-text))', marginBottom: 4 },
  itemStyle: { color: 'rgb(var(--cc-muted))', padding: '1px 0' },
  cursor: { stroke: 'rgb(var(--cc-border-strong))', strokeWidth: 1 },
};

export const kLitres = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
