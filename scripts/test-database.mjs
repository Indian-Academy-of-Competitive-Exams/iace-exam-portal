/**
 * The database the test tier runs against, guarded and migrated. Shared by scripts/test-db.mjs and
 * scripts/coverage.mjs so the two cannot disagree about which database is safe to fill with rows.
 *
 * It refuses a missing URL, the DATABASE_URL database, and any database not named `*_test`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TEST_DATABASE_SUFFIX = '_test';

/** One variable, the shell's first — read, never loaded, so .env does not leak into the test run's env. */
export function envValue(variable) {
  if (process.env[variable]) return process.env[variable];
  try {
    return parseEnv(readFileSync(join(ROOT, '.env'), 'utf8'))[variable];
  } catch {
    return undefined;
  }
}

/** Credentials and options aside, two URLs on one host, port and database are one database. */
function databaseOf(url) {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || '5432'}${pathname}`;
}

const databaseNameOf = (url) => decodeURIComponent(new URL(url).pathname.slice(1));

function refuse(reason) {
  console.error(`test database: ${reason}`);
  process.exit(1);
}

/** Migrates the test database and returns the environment every database test must run under. */
export function prepareTestDatabase() {
  const testUrl = envValue('TEST_DATABASE_URL');
  const devUrl = envValue('DATABASE_URL');

  if (!testUrl) {
    refuse(
      'TEST_DATABASE_URL is not set. Add it to .env (see .env.example); never the dev database.',
    );
  }
  if (devUrl && databaseOf(testUrl) === databaseOf(devUrl)) {
    refuse(
      'TEST_DATABASE_URL names the DATABASE_URL database, and the tests would fill it with rows.',
    );
  }
  if (!databaseNameOf(testUrl).endsWith(TEST_DATABASE_SUFFIX)) {
    refuse(
      `TEST_DATABASE_URL names "${databaseNameOf(testUrl)}"; the tests run only on a database whose name ends in "${TEST_DATABASE_SUFFIX}".`,
    );
  }

  const env = { ...process.env, DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl };
  try {
    execFileSync(
      join(ROOT, 'node_modules/.bin/prisma'),
      ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { cwd: ROOT, env, stdio: 'inherit' },
    );
  } catch (error) {
    process.exit(error.status ?? 1);
  }
  return env;
}
