/* ============================================================================
   IACE Design System — Tailwind preset
   packages/ui/tailwind.preset.js
   Each app's tailwind.config.js does:  presets: [require('@iace/ui/tailwind.preset')]
   Colors map to the CSS variables in tokens.css, so light/dark swap in one place
   and classes like bg-primary / text-muted-foreground / border-border just work.
   ============================================================================ */

const path = require('node:path');
const plugin = require('tailwindcss/plugin');

/**
 * Which files Tailwind must READ to know a class is used.
 *
 * This lives in the preset, not in each app's config, because getting it wrong
 * does not fail — it silently omits CSS. `AppShell` lives in
 * `packages/app-kit/browser`, and while that directory went unscanned the
 * entire signed-in chrome was styled by classes Tailwind never emitted:
 * `max-w-6xl` (so the shell had no max width and content ran edge to edge),
 * `py-8` (so there was no gap between the nav and the page), `sm:inline` (so
 * the responsive rules never applied) and `z-10`. Nothing errored. The build
 * was green and the pages were simply wrong, in a way that reads as a design
 * problem rather than a config one.
 *
 * Resolved from __dirname so it is correct whatever directory the build runs
 * in, and globbed by package rather than listed one by one so a new package
 * with a component in it is covered the day it is created. Both `src` and
 * `browser` are matched: app-kit splits its DOM-free tier from its web tier
 * across exactly those two (docs/03 §3).
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_CONTENT = [path.join(REPO_ROOT, 'packages/*/{src,browser}/**/*.{ts,tsx}')];

/**
 * Wraps a CSS-variable colour so BOTH call shapes work.
 *
 * Tailwind asks for a colour twice over, and the two are easy to conflate:
 *
 *   - with no alpha modifier it passes `opacityValue` as the STRING
 *     "var(--tw-bg-opacity)", part of its own opacity mechanism;
 *   - with `/14` it passes the number 0.14.
 *
 * Treating the first as a number yields `color-mix(... NaN%, transparent)`,
 * which is invalid, so the browser drops the declaration entirely. That is
 * silent: in light mode the fallbacks happen to look like the intended theme,
 * and only a badge that refused to show a background gave it away.
 *
 * So: plain `var()` unless a real number arrives, and color-mix only then.
 */
const token =
  (name) =>
  ({ opacityValue }) => {
    const isNumericAlpha =
      typeof opacityValue === 'number' || /^[\d.]+$/.test(String(opacityValue));
    return opacityValue === undefined || !isNumericAlpha
      ? `var(${name})`
      : // Rounded: 0.14 * 100 is 14.000000000000002 in binary floating point,
        // and that lands verbatim in the generated CSS.
        `color-mix(in srgb, var(${name}) ${Number((Number(opacityValue) * 100).toFixed(4))}%, transparent)`;
  };

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Merged with each app's own `content`, so an app declares only itself.
  content: WORKSPACE_CONTENT,
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        surface: { DEFAULT: token('--surface'), 2: token('--surface-2') },
        // `secondary` is the dimmer body ink — quieter than --foreground, not
        // as quiet as --muted-foreground. It was missing here while
        // `text-foreground-secondary` was already written in the app shell, and
        // an undeclared colour is not an error in Tailwind: the class matches
        // nothing, no CSS is emitted, and the text simply inherits. Two of the
        // shell's labels have been rendering at full foreground weight since.
        foreground: { DEFAULT: token('--foreground'), secondary: token('--foreground-secondary') },
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
          // The quiet brand pair — a tinted ground with brand-coloured ink, for
          // marking something as current without shouting. `subtle`/`ink` were
          // declared in tokens.css and used by the sidebar's active row, but
          // never mapped here, so `bg-primary-subtle text-primary-ink` emitted
          // nothing at all: the selected nav item lost its idle styling and
          // gained none of its own, leaving no visible current page.
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
      keyframes: {
        // Short enough to feel like the tooltip was already there, long enough
        // not to snap. Lives here so no component hand-rolls its own timing.
        'tooltip-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Settles down from the top edge it is anchored to. Six pixels, not
        // sixty: a toast is a remark, not an arrival.
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // The dim behind a dialog. Opacity only — anything that moves here
        // reads as the page itself shifting under the reader.
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Rises the last few pixels into place. Ends at `none` rather than a
        // written-out transform, so the dialog owns no transform once it has
        // landed and centring stays the layout's job.
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(0.75rem) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        // A panel arriving from the edge it is anchored to. Two keyframes, not
        // one parameterised by a variable, because a transform is not something
        // Tailwind can interpolate a direction into.
        'sheet-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'sheet-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        // Radix keeps a closing panel mounted only while an animation runs on it.
        'overlay-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'dialog-out': {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'translateY(0.5rem) scale(0.98)' },
        },
        'sheet-out-left': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-100%)' },
        },
        'sheet-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        // The sheen crossing a skeleton. Travels from off one edge to off the
        // other, so it never parks in the middle of the placeholder.
        'skeleton-sweep': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'tooltip-in': 'tooltip-in 120ms ease-out',
        'toast-in': 'toast-in 160ms ease-out',
        // --dur-fast / --ease-out.
        'overlay-in': 'overlay-in 140ms cubic-bezier(0.2, 0, 0, 1)',
        // --dur-normal / --ease-spring. The one place a little overshoot earns
        // its keep: a dialog interrupts, and should feel like it landed.
        'dialog-in': 'dialog-in 220ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        // --skeleton-dur / --ease-in-out. Slow on purpose: a fast sweep reads
        // as something happening rather than as something being waited for.
        'skeleton-sweep': 'skeleton-sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        // --dur-normal / --ease-out. No overshoot here, unlike the dialog: a
        // panel that bounces off the screen edge it is attached to looks loose.
        'sheet-in-left': 'sheet-in-left 220ms cubic-bezier(0.2, 0, 0, 1)',
        'sheet-in-right': 'sheet-in-right 220ms cubic-bezier(0.2, 0, 0, 1)',
        // Quicker than arriving, and eased IN: nobody waits on a thing already dismissed.
        'overlay-out': 'overlay-out 120ms cubic-bezier(0.4, 0, 1, 1)',
        'dialog-out': 'dialog-out 140ms cubic-bezier(0.4, 0, 1, 1)',
        'sheet-out-left': 'sheet-out-left 180ms cubic-bezier(0.4, 0, 1, 1)',
        'sheet-out-right': 'sheet-out-right 180ms cubic-bezier(0.4, 0, 1, 1)',
      },
      fontFamily: {
        // Single source of truth: the bilingual Inter + Noto stack lives in
        // tokens.css (--font-sans). Keeping it here too would drift.
        sans: ['var(--font-sans)'],
        // Mapped for the same reason, and because leaving it out is not
        // neutral: `font-mono` still WORKS without this line, it just silently
        // resolves to Tailwind's default stack instead of ours, so the token
        // reads as unused while the system quietly has two mono faces.
        mono: ['var(--font-mono)'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [
    /**
     * The base layer every app renders on.
     *
     * It lived in each app's index.css, byte-identical, which made the default
     * border colour and the page's own background an app decision — exactly the
     * kind of value that drifts once and is then wrong in one place forever.
     * Delivered through the preset rather than a CSS file so apps need no
     * @import machinery: they keep only the three @tailwind directives.
     */
    plugin(({ addBase }) => {
      addBase({
        '*': { borderColor: 'var(--border)' },
        // WebKit draws its own ✕ inside a search field. SearchInput ships one
        // that is themed, keyboard-reachable and labelled, and two clear
        // buttons side by side is one of them being wrong.
        'input[type="search"]::-webkit-search-cancel-button': { display: 'none' },
        body: {
          backgroundColor: 'var(--background)',
          color: 'var(--foreground)',
          '-webkit-font-smoothing': 'antialiased',
          '-moz-osx-font-smoothing': 'grayscale',
          fontFeatureSettings: "'rlig' 1, 'calt' 1",
        },
      });
    }),
  ],
};
