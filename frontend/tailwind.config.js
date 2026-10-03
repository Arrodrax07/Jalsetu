/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic design tokens (defined in src/index.css). Use these instead of raw palette colours.
        cc: {
          bg: v('cc-bg'),
          surface: v('cc-surface'),
          raised: v('cc-raised'),
          hover: v('cc-hover'),
          border: v('cc-border'),
          strong: v('cc-border-strong'),
          text: v('cc-text'),
          muted: v('cc-muted'),
          faint: v('cc-faint'),
          accent: v('cc-accent'),
          'accent-strong': v('cc-accent-strong'),
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
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgb(19 31 42 / 0.04), 0 8px 24px -16px rgb(19 31 42 / 0.12)',
        pop: '0 24px 60px -24px rgb(19 31 42 / 0.35), 0 2px 6px rgb(19 31 42 / 0.06)',
        lift: '0 2px 4px rgb(19 31 42 / 0.04), 0 16px 32px -16px rgb(19 31 42 / 0.22)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
