/**
 * Everything visual comes from the shared preset, which maps Tailwind's colour,
 * radius and shadow names onto the CSS variables in @iace/ui/tokens.css.
 * Do NOT add colours, spacing or radii here — add a token in packages/ui.
 */
import animate from 'tailwindcss-animate';
import preset from '@iace/ui/tailwind.preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // The design-system components ship as source, so Tailwind must scan them.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  plugins: [animate],
};
