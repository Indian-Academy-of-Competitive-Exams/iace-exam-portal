import config from '@iace/config/eslint-react';

export default [
  // tailwind.preset.js is a CommonJS Tailwind config consumed by each app's
  // build step, not app source — linting it as browser ESM is a false positive.
  { ignores: ['tailwind.preset.js'] },
  ...config,
  {
    files: ['src/components/**/*.tsx'],
    rules: {
      // A component library is not an HMR surface, and exporting the cva
      // variants next to the component is the shadcn convention.
      'react-refresh/only-export-components': 'off',
    },
  },
];
