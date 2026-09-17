/**
 * The database test tier: migrate the guarded test database (scripts/test-database.mjs), then run
 * apps/api/test-db against it one file at a time.
 *
 * Named files run alone (`pnpm test:db test-db/x.db.test.ts`); with none, the whole tier runs.
 */
import { execFileSync } from 'node:child_process';
import { ROOT, prepareTestDatabase } from './test-database.mjs';

const env = prepareTestDatabase();
const named = process.argv.slice(2);

const run = named.length
  ? [
      '--filter',
      '@iace/api',
      'exec',
      'node',
      '--import',
      'tsx',
      '--test',
      '--test-concurrency=1',
      ...named,
    ]
  : ['--filter', '@iace/api', 'test:db'];

try {
  execFileSync('pnpm', run, {
    cwd: ROOT,
    env: { ...env, TSX_TSCONFIG_PATH: 'test/tsconfig.json' },
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(error.status ?? 1);
}
