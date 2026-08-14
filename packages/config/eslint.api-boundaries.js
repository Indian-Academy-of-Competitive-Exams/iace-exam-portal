// Wires the module-boundary rule (docs/03 §4, §12) into apps/api.
//
// `src` only. Tests are allowed to reach into whatever they are testing — a
// unit test of `pin.service` that could only see the auth barrel would be
// testing the barrel.
import { defineConfig } from 'eslint/config';
import { iaceBoundariesPlugin } from './eslint-rules/api-module-boundaries.js';

export default defineConfig([
  {
    files: ['src/**/*.ts'],
    plugins: { '@iace': iaceBoundariesPlugin },
    rules: { '@iace/api-module-boundaries': 'error' },
  },
]);
