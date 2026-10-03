// Chart tokens for the light "water atlas" surface (white panels on warm paper).
// Categorical order is fixed: water blue, ochre, plum. Distinct in hue and lightness (separable with
// deuteranopia/protanopia) and >= 3:1 against white.
export const SERIES = ['#0c6e96', '#c4880a', '#7b4fb4'] as const;
export const REFERENCE = '#8c96a0';
export const GRID = '#ebe7de';
export const AXIS_TICK = { fontSize: 11, fill: '#6b7682' };

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e5e1d7', background: '#ffffff', fontSize: 12, color: '#131f2a', boxShadow: '0 12px 28px -14px rgb(19 31 42 / .3)' },
  labelStyle: { fontWeight: 600, color: '#131f2a' },
  itemStyle: { color: '#3c4a56' },
};

export const kLitres = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
