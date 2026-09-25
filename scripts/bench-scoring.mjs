/** Runs apps/api/test-db/scoring-load.bench.ts against the guarded test database. Not a gate. */
import { execFileSync } from 'node:child_process';
import { ROOT, prepareTestDatabase } from './test-database.mjs';

const env = prepareTestDatabase();

execFileSync(
  'pnpm',
  [
    '--filter',
    '@iace/api',
    'exec',
    'node',
    '--import',
    'tsx',
    'test-db/scoring-load.bench.ts',
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, env: { ...env, TSX_TSCONFIG_PATH: 'test/tsconfig.json' }, stdio: 'inherit' },
);
