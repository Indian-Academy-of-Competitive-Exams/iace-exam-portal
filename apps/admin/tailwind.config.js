/**
 * Everything visual comes from the shared preset, which maps Tailwind's colour,
 * radius and shadow names onto the CSS variables in @iace/ui/tokens.css.
 * Do NOT add colours, spacing or radii here — add a token in packages/ui.
 */
import animate from 'tailwindcss-animate';
// Relative, not the '@iace/ui' specifier: Tailwind watches a config's relative imports only.
import preset from '../../packages/ui/tailwind.preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [...preset.content, './index.html', './src/**/*.{ts,tsx}'],
  plugins: [animate],
};
