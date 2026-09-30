/**
 * Everything visual comes from the shared preset, which maps Tailwind's colour,
 * radius and shadow names onto the CSS variables in @iace/ui/tokens.css.
 * Do NOT add colours, spacing or radii here — add a token in packages/ui.
 */
// Relative, not the '@iace/ui' specifier: Tailwind watches a config's relative imports only.
import preset from '../../packages/ui/tailwind.preset.js';

// A twin of apps/test's today, not by contract: admin is dense and data-first, and may diverge.
/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [...preset.content, './index.html', './src/**/*.{ts,tsx}'],
};
