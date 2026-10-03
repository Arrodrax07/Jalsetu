/** @type {import('tailwindcss').Config} */
// Every colour resolves to a CSS variable (src/index.css), so light and dark themes share one set of class names.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
// The few raw palette shades pages use for semantic text/fills are remapped to theme-aware variables too.
const shades = (hue, list) => Object.fromEntries(list.map(s => [s, v(`p-${hue}-${s}`)]));

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cc: {
          bg: v('cc-bg'),
          surface: v('cc-surface'),
          raised: v('cc-raised'),
          sunken: v('cc-sunken'),
          hover: v('cc-hover'),
          border: v('cc-border'),
          strong: v('cc-border-strong'),
          text: v('cc-text'),
          muted: v('cc-muted'),
          faint: v('cc-faint'),
          ink: v('cc-ink'),
          'on-ink': v('cc-on-ink'),
          accent: v('cc-accent'),
          'accent-strong': v('cc-accent-strong'),
          'accent-soft': v('cc-accent-soft'),
          violet: v('cc-violet'),
          teal: v('cc-teal'),
          live: v('cc-live'),
          stale: v('cc-stale'),
          offline: v('cc-offline'),
          nosignal: v('cc-nosignal'),
          extreme: v('cc-sev-extreme'),
          severe: v('cc-sev-severe'),
          moderate: v('cc-sev-moderate'),
          minor: v('cc-sev-minor'),
          seeded: v('cc-seeded'),
          external: v('cc-external'),
          predicted: v('cc-predicted'),
          estimated: v('cc-estimated'),
          ok: v('cc-ok'),
          warn: v('cc-warn'),
          danger: v('cc-danger'),
        },
        red: shades('red', [500, 700, 800]),
        amber: shades('amber', [50, 100, 300, 600, 700, 800, 900, 950]),
        green: shades('green', [700, 800]),
        emerald: shades('emerald', [300]),
        violet: shades('violet', [500, 700]),
        sky: shades('sky', [500, 700, 800]),
        pink: shades('pink', [700]),
        teal: shades('teal', [800]),
        orange: shades('orange', [400]),
        cyan: shades('cyan', [700]),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', '"Mukta"', 'system-ui', 'sans-serif'],
        display: ['"Mona Sans Variable"', '"Geist Variable"', '"Mukta"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Shape system: containers 14px, controls 10px, status chips are pills.
        card: '14px',
        control: '10px',
      },
      boxShadow: {
        // Tinted to the ink hue, single light source from above.
        panel: '0 1px 0 rgb(var(--cc-shadow) / 0.04), 0 1px 3px rgb(var(--cc-shadow) / 0.05)',
        lift: '0 1px 0 rgb(var(--cc-shadow) / 0.04), 0 12px 28px -14px rgb(var(--cc-shadow) / 0.28)',
        pop: '0 1px 0 rgb(var(--cc-shadow) / 0.05), 0 28px 64px -28px rgb(var(--cc-shadow) / 0.45), 0 4px 12px -6px rgb(var(--cc-shadow) / 0.12)',
        float: '0 8px 24px -10px rgb(var(--cc-shadow) / 0.35), 0 1px 0 rgb(var(--cc-shadow) / 0.06)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
        spatial: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      zIndex: { map: '5', overlay: '10', sticky: '20', drawer: '50', palette: '70', toast: '80' },
    },
  },
  plugins: [],
}
