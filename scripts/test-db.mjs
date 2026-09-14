/**
 * The database test tier: migrate the guarded test database (scripts/test-database.mjs), then run
 * apps/api/test-db against it one file at a time.
 */
import { execFileSync } from 'node:child_process';
import { ROOT, prepareTestDatabase } from './test-database.mjs';

const env = prepareTestDatabase();

try {
  execFileSync('pnpm', ['--filter', '@iace/api', 'test:db'], { cwd: ROOT, env, stdio: 'inherit' });
} catch (error) {
  process.exit(error.status ?? 1);
}
