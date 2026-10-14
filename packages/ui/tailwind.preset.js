/* ============================================================================
   IACE Design System — Tailwind preset
   packages/ui/tailwind.preset.js
   Each app's tailwind.config.js does:  presets: [require('@iace/ui/tailwind.preset')]
   Colors map to the CSS variables in tokens.css, so light/dark swap in one place
   and classes like bg-primary / text-muted-foreground / border-border just work.
   ============================================================================ */

const path = require('node:path');
const plugin = require('tailwindcss/plugin');

/** Which files Tailwind must READ to know a class is used — get this wrong and CSS silently omits, no error; resolved from __dirname and globbed by package (both `src` and `browser`, app-kit's DOM-free/web split, docs/03 §3) so every package is covered. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_CONTENT = [path.join(REPO_ROOT, 'packages/*/{src,browser}/**/*.{ts,tsx}')];

/** Wraps a CSS-variable colour for Tailwind's two call shapes: no alpha modifier passes `opacityValue` as the string "var(--tw-bg-opacity)", `/14` passes the number 0.14 — treating the first as a number yields invalid color-mix that the browser silently drops, so plain `var()` unless a real number arrives. */
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

const shared = require('./tailwind.tokens.cjs')(token);

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Merged with each app's own `content`, so an app declares only itself.
  content: WORKSPACE_CONTENT,
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: shared.colors,
      spacing: shared.spacing,
      borderRadius: shared.borderRadius,
      boxShadow: {
        sm: token('--shadow-sm'),
        md: token('--shadow-md'),
        lg: token('--shadow-lg'),
        // Named, because `shadow-[--shadow-overlay]` compiled to a shadow COLOUR and painted nothing.
        overlay: token('--shadow-overlay'),
        // Focus and invalid are elevation-like tokens on purpose: a control should never hand-roll either, or the two drift into looking alike.
        focus: token('--focus-ring'),
        'focus-invalid': token('--focus-ring-invalid'),
      },
      keyframes: {
        // Short enough to feel like the tooltip was already there, long enough not to snap; lives here so no component hand-rolls its own timing.
        'tooltip-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Settles down from the top edge it's anchored to — six pixels, not sixty: a toast is a remark, not an arrival.
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // The dim behind a dialog: opacity only — anything that moves here reads as the page itself shifting under the reader.
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Rises the last few pixels into place; ends at `none` rather than a written-out transform, so the dialog owns no transform once landed and centring stays the layout's job.
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(0.75rem) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        // A panel arriving from the left edge it is anchored to.
        'sheet-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        // The same arrival from the right edge, for a panel anchored there instead.
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
        // The sheen crossing a skeleton travels from off one edge to off the other, so it never parks in the middle of the placeholder.
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
        // --dur-normal / --ease-spring: the one place a little overshoot earns its keep — a dialog interrupts, and should feel like it landed.
        'dialog-in': 'dialog-in 220ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        // --skeleton-dur / --ease-in-out: slow on purpose, a fast sweep reads as something happening rather than being waited for.
        'skeleton-sweep': 'skeleton-sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        // --dur-normal / --ease-out: no overshoot here, unlike the dialog — a panel bouncing off the screen edge it's attached to looks loose.
        'sheet-in-left': 'sheet-in-left 220ms cubic-bezier(0.2, 0, 0, 1)',
        'sheet-in-right': 'sheet-in-right 220ms cubic-bezier(0.2, 0, 0, 1)',
        // Quicker than arriving, and eased IN: nobody waits on a thing already dismissed.
        'overlay-out': 'overlay-out 120ms cubic-bezier(0.4, 0, 1, 1)',
        'dialog-out': 'dialog-out 140ms cubic-bezier(0.4, 0, 1, 1)',
        'sheet-out-left': 'sheet-out-left 180ms cubic-bezier(0.4, 0, 1, 1)',
        'sheet-out-right': 'sheet-out-right 180ms cubic-bezier(0.4, 0, 1, 1)',
      },
      fontFamily: shared.fontFamily,
      // The WHOLE scale: an unmapped step silently renders Tailwind's size, not the token's.
      fontSize: {
        '2xs': ['var(--text-2xs)', { lineHeight: 'var(--leading-snug)' }],
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-snug)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-normal)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        md: ['var(--text-md)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-snug)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-tight)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-tight)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
        // lineHeight 1 sets it solid: the plate's height is then padding alone.
        brand: ['var(--text-brand)', { lineHeight: '1' }],
      },
      letterSpacing: shared.letterSpacing,
      lineHeight: {
        tight: 'var(--leading-tight)',
        snug: 'var(--leading-snug)',
        normal: 'var(--leading-normal)',
        relaxed: 'var(--leading-relaxed)',
        indic: 'var(--leading-indic)',
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [
    /** The base layer every app renders on, delivered through the preset rather than a CSS file so apps need no @import machinery — just the three @tailwind directives. */
    plugin(({ addBase }) => {
      addBase({
        '*': { borderColor: 'var(--border)' },
        // WebKit draws its own ✕ inside a search field; SearchInput ships a themed, keyboard-reachable, labelled one, so two clear buttons side by side would mean one is wrong.
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
