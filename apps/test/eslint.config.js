import config from '@iace/config/eslint-react';

/** The service worker is plain JS on a global scope the React config knows nothing about. */
export default [
  ...config,
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
