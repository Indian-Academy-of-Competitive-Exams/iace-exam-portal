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
  // Tailwind does NOT merge `content` across presets — whichever config
  // defines it first wins outright, so a preset that declares content is
  // silently ignored. Hence the spread: `preset.content` carries every shared
  // package that ships components (@iace/ui, @iace/app-kit), and this file adds
  // only what belongs to this app. Dropping the spread compiles, builds green,
  // and quietly stops emitting the shell's classes — see the coverage test in
  // packages/config.
  content: [...preset.content, './index.html', './src/**/*.{ts,tsx}'],
  plugins: [animate],
};
