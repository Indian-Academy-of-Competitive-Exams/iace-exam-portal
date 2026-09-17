/**
 * The native twin of packages/ui/tailwind.preset.js: same token vocabulary,
 * bare var(--token) instead of the web preset's color-mix() alpha wrapper —
 * React Native has no CSS colour functions, so a translucent surface needs
 * its own token in packages/ui, not an alpha modifier here.
 */
const token = (name) => () => `var(${name})`;

/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        surface: { DEFAULT: token('--surface'), 2: token('--surface-2') },
        foreground: { DEFAULT: token('--foreground'), secondary: token('--foreground-secondary') },
        border: token('--border'),
        input: token('--input'),
        ring: token('--ring'),

        card: { DEFAULT: token('--surface'), foreground: token('--foreground') },
        popover: { DEFAULT: token('--surface'), foreground: token('--foreground') },
        muted: { DEFAULT: token('--muted'), foreground: token('--muted-foreground') },
        placeholder: token('--placeholder'),
        disabled: {
          DEFAULT: token('--disabled-bg'),
          foreground: token('--disabled-fg'),
          border: token('--disabled-border'),
        },
        accent: { DEFAULT: token('--muted'), foreground: token('--foreground') },

        primary: {
          DEFAULT: token('--primary'),
          hover: token('--primary-hover'),
          foreground: token('--primary-foreground'),
          subtle: token('--primary-subtle'),
          ink: token('--primary-ink'),
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

        exam: {
          surface: token('--exam-surface'),
          'surface-2': token('--exam-surface-2'),
          ink: token('--exam-ink'),
          'ink-muted': token('--exam-ink-muted'),
          border: token('--exam-border'),
          answered: token('--exam-answered'),
          'answered-ink': token('--exam-answered-ink'),
          notanswered: token('--exam-notanswered'),
          'notanswered-ink': token('--exam-notanswered-ink'),
          notvisited: token('--exam-notvisited'),
          'notvisited-ink': token('--exam-notvisited-ink'),
          marked: token('--exam-marked'),
          'marked-ink': token('--exam-marked-ink'),
          'answered-marked': token('--exam-answered-marked'),
          'answered-marked-ink': token('--exam-answered-marked-ink'),
          'answered-marked-tick': token('--exam-answered-marked-tick'),
          current: token('--exam-current'),
          option: token('--exam-option-bg'),
          'option-border': token('--exam-option-border'),
          'option-selected': token('--exam-option-selected-bg'),
          'option-selected-border': token('--exam-option-selected-border'),
          'section-ink': token('--exam-section-ink'),
          'section-active': token('--exam-section-active-bg'),
          'section-active-ink': token('--exam-section-active-ink'),
          'timer-ink': token('--exam-timer-ink'),
          'timer-bg': token('--exam-timer-bg'),
          'timer-border': token('--exam-timer-border'),
          'timer-urgent': token('--exam-timer-urgent-bg'),
          'timer-urgent-ink': token('--exam-timer-urgent-ink'),
          'timer-urgent-border': token('--exam-timer-urgent-border'),
        },
      },
      spacing: {
        exam: token('--exam-pad'),
        'exam-gap': token('--exam-gap'),
        'exam-cell': token('--exam-cell-size'),
        'exam-cell-gap': token('--exam-cell-gap'),
      },
      borderRadius: {
        sm: token('--radius-sm'),
        md: token('--radius-md'),
        lg: token('--radius-lg'),
        xl: token('--radius-xl'),
        '2xl': token('--radius-2xl'),
        'exam-cell': token('--exam-cell-radius'),
        'exam-option': token('--exam-option-radius'),
      },
      boxShadow: {
        sm: token('--shadow-sm'),
        md: token('--shadow-md'),
        lg: token('--shadow-lg'),
        focus: token('--focus-ring'),
        'focus-invalid': token('--focus-ring-invalid'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
        brand: ['var(--font-brand)'],
      },
      // No lineHeight: the tokens are unitless multipliers, which React Native reads as points and crops text to.
      fontSize: {
        '2xs': 'var(--text-2xs)',
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        base: 'var(--text-base)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
        '3xl': 'var(--text-3xl)',
        brand: 'var(--text-brand)',
      },
      letterSpacing: {
        tight: 'var(--tracking-tight)',
        snug: 'var(--tracking-snug)',
        normal: 'var(--tracking-normal)',
        wide: 'var(--tracking-wide)',
        brand: 'var(--tracking-brand)',
      },
    },
  },
};
