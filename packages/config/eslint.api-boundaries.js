// Wires the module-boundary rule (docs/03 §4, §12) into apps/api.
//
// `src` only. Tests are allowed to reach into whatever they are testing — a
// unit test of `pin.service` that could only see the auth barrel would be
// testing the barrel.
import { defineConfig } from 'eslint/config';
import { apiModuleBoundaries } from './eslint-rules/api-module-boundaries.js';
import { noHotPathDbWrite } from './eslint-rules/no-hot-path-db-write.js';

const iacePlugin = {
  meta: { name: '@iace' },
  rules: {
    'api-module-boundaries': apiModuleBoundaries,
    'no-hot-path-db-write': noHotPathDbWrite,
  },
};

/** The live answer path and ONLY it: the flusher, submit and the sweeper write Postgres by design. */
const LIVE_ANSWER_PATH = [
  'src/attempts/attempt-state.service.ts',
  'src/attempts/attempt-state.ts',
  'src/attempts/attempts.controller.ts',
];

export default defineConfig([
  {
    files: ['src/**/*.ts'],
    plugins: { '@iace': iacePlugin },
    rules: { '@iace/api-module-boundaries': 'error' },
  },
  {
    files: LIVE_ANSWER_PATH,
    plugins: { '@iace': iacePlugin },
    rules: { '@iace/no-hot-path-db-write': 'error' },
  },
]);
