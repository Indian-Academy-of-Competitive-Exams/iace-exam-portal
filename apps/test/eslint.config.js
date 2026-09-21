import config from '@iace/config/eslint-react';

/** The service worker is plain JS on a global scope the React config knows nothing about. */
export default [
  ...config,
  {
    // This skin reproduces a third-party CBT exactly; a token here would be a deviation from it.
    files: ['src/components/exam/templates/railway/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
      },
    },
  },
];
