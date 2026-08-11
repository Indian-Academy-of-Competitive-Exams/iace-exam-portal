/* ============================================================================
   IACE Design System — Tailwind preset
   packages/ui/tailwind.preset.js
   Each app's tailwind.config.js does:  presets: [require('@iace/ui/tailwind.preset')]
   Colors map to the CSS variables in tokens.css, so light/dark swap in one place
   and classes like bg-primary / text-muted-foreground / border-border just work.
   ============================================================================ */

/**
 * Tailwind cannot compute an alpha channel from a bare `var(--x)`, so it
 * silently DROPS the utility: `bg-destructive/10` emitted no CSS whatsoever,
 * and the error banner that used it had no background at all. Nothing errored —
 * the class simply did not exist.
 *
 * Wrapping each token in this keeps the hex values in tokens.css (so plain CSS
 * and the style guide can still use `var(--primary)` directly) while making
 * every `/alpha` modifier work through color-mix.
 */
const token =
  (name) =>
  ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) ${Number(opacityValue) * 100}%, transparent)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        surface: { DEFAULT: token('--surface'), 2: token('--surface-2') },
        foreground: token('--foreground'),
        border: token('--border'),
        input: token('--input'),
        ring: token('--ring'),

        // shadcn-compatible roles
        card: { DEFAULT: token('--surface'), foreground: token('--foreground') },
        popover: { DEFAULT: token('--surface'), foreground: token('--foreground') },
        muted: { DEFAULT: token('--muted'), foreground: token('--muted-foreground') },
        accent: { DEFAULT: token('--muted'), foreground: token('--foreground') },

        primary: {
          DEFAULT: token('--primary'),
          hover: token('--primary-hover'),
          foreground: token('--primary-foreground'),
        },
        secondary: {
          DEFAULT: token('--secondary'),
          hover: token('--secondary-hover'),
          foreground: token('--secondary-foreground'),
        },
        destructive: {
          DEFAULT: token('--destructive'),
          hover: token('--destructive-hover'),
          foreground: token('--destructive-foreground'),
        },
        success: {
          DEFAULT: token('--success'),
          foreground: token('--success-foreground'),
          subtle: token('--success-subtle'),
          ink: token('--success-ink'),
        },
        warning: {
          DEFAULT: token('--warning'),
          foreground: token('--warning-foreground'),
          subtle: token('--warning-subtle'),
          ink: token('--warning-ink'),
        },
        info: {
          DEFAULT: token('--info'),
          foreground: token('--info-foreground'),
          subtle: token('--info-subtle'),
          ink: token('--info-ink'),
        },

        // chart series (assign in fixed order, never cycle)
        series: {
          1: token('--series-1'),
          2: token('--series-2'),
          3: token('--series-3'),
          4: token('--series-4'),
          5: token('--series-5'),
          6: token('--series-6'),
          7: token('--series-7'),
          8: token('--series-8'),
        },
        chart: {
          surface: token('--chart-surface'),
          grid: token('--chart-grid'),
          axis: token('--chart-axis'),
          ink: token('--chart-ink'),
        },

        // exam CBT palette (CBT screen only — separate from brand semantics)
        exam: {
          answered: token('--exam-answered'),
          notanswered: token('--exam-notanswered'),
          notvisited: token('--exam-notvisited'),
          marked: token('--exam-marked'),
        },
      },
      borderRadius: {
        sm: token('--radius-sm'),
        md: token('--radius-md'),
        lg: token('--radius-lg'),
        xl: token('--radius-xl'),
        '2xl': token('--radius-2xl'),
      },
      boxShadow: {
        sm: token('--shadow-sm'),
        md: token('--shadow-md'),
        lg: token('--shadow-lg'),
        // Focus and invalid are elevation-like tokens on purpose: a control
        // should never hand-roll either, or the two drift into looking alike.
        focus: token('--focus-ring'),
        'focus-invalid': token('--focus-ring-invalid'),
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [],
};
