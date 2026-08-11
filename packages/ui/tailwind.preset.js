/* ============================================================================
   IACE Design System — Tailwind preset
   packages/ui/tailwind.preset.js
   Each app's tailwind.config.js does:  presets: [require('@iace/ui/tailwind.preset')]
   Colors map to the CSS variables in tokens.css, so light/dark swap in one place
   and classes like bg-primary / text-muted-foreground / border-border just work.
   ============================================================================ */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        foreground: 'var(--foreground)',
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',

        // shadcn-compatible roles
        card: { DEFAULT: 'var(--surface)', foreground: 'var(--foreground)' },
        popover: { DEFAULT: 'var(--surface)', foreground: 'var(--foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        accent: { DEFAULT: 'var(--muted)', foreground: 'var(--foreground)' },

        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          hover: 'var(--secondary-hover)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          hover: 'var(--destructive-hover)',
          foreground: 'var(--destructive-foreground)',
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
          subtle: 'var(--success-subtle)',
          ink: 'var(--success-ink)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: 'var(--warning-foreground)',
          subtle: 'var(--warning-subtle)',
          ink: 'var(--warning-ink)',
        },
        info: {
          DEFAULT: 'var(--info)',
          foreground: 'var(--info-foreground)',
          subtle: 'var(--info-subtle)',
          ink: 'var(--info-ink)',
        },

        // chart series (assign in fixed order, never cycle)
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
          4: 'var(--series-4)',
          5: 'var(--series-5)',
          6: 'var(--series-6)',
          7: 'var(--series-7)',
          8: 'var(--series-8)',
        },
        chart: {
          surface: 'var(--chart-surface)',
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis)',
          ink: 'var(--chart-ink)',
        },

        // exam CBT palette (CBT screen only — separate from brand semantics)
        exam: {
          answered: 'var(--exam-answered)',
          notanswered: 'var(--exam-notanswered)',
          notvisited: 'var(--exam-notvisited)',
          marked: 'var(--exam-marked)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
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
