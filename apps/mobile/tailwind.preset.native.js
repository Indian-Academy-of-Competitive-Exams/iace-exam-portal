/**
 * The native twin of packages/ui/tailwind.preset.js: same token vocabulary,
 * bare var(--token) instead of the web preset's color-mix() alpha wrapper —
 * React Native has no CSS colour functions, so a translucent surface needs
 * its own token in packages/ui, not an alpha modifier here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import plugin from 'tailwindcss/plugin.js';
import tokenMaps from '../../packages/ui/tailwind.tokens.cjs';

const token = (name) => () => `var(${name})`;
const shared = tokenMaps(token);

// __dirname, not import.meta: tailwind loads this preset through jiti, as CommonJS.
const TOKENS_CSS = path.resolve(__dirname, '../../packages/ui/src/tokens.css');

const DARK_ROOT = ":root[data-theme='dark'] {";
const DARK_EXAM = ":root[data-theme='dark'] [data-exam-template='default'] {";

/** Native has no document root to hang data-theme on, so a block keyed by it never matches. */
function darkTokens(selector) {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const opens = css.indexOf(selector);
  if (opens === -1) throw new Error(`tokens.css no longer declares ${selector}`);
  const body = css.slice(opens + selector.length, css.indexOf('\n}', opens));
  const declared = [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)];
  if (declared.length === 0) throw new Error(`${selector} declared nothing`);
  return Object.fromEntries(declared.map(([, name, value]) => [name, value.trim()]));
}

/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: shared.colors,
      spacing: shared.spacing,
      borderRadius: shared.borderRadius,
      boxShadow: {
        sm: token('--shadow-sm'),
        md: token('--shadow-md'),
        lg: token('--shadow-lg'),
        focus: token('--focus-ring'),
        'focus-invalid': token('--focus-ring-invalid'),
      },
      fontFamily: shared.fontFamily,
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
      letterSpacing: shared.letterSpacing,
    },
  },
  plugins: [
    // Appearance drives this media query on native, which is what `dark:` compiles to.
    plugin(({ addBase }) =>
      addBase({
        '@media (prefers-color-scheme: dark)': {
          ':root': darkTokens(DARK_ROOT),
          '.exam-template-default': darkTokens(DARK_EXAM),
        },
      }),
    ),
  ],
};
