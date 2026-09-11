/**
 * The database test tier: apply every migration to the database TEST_DATABASE_URL names, then run
 * apps/api/test-db against it one file at a time. `.env` is parsed like scripts/db-check.mjs.
 *
 * It refuses a missing URL, the DATABASE_URL database, and any database not named `*_test`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TEST_DATABASE_SUFFIX = '_test';

function fromEnvFile(variable) {
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8')
      .split('\n')
      .find((it) => it.startsWith(`${variable}=`));
    return line?.slice(variable.length + 1).trim();
  } catch {
    return undefined;
  }
}

const resolve = (variable) => process.env[variable] || fromEnvFile(variable);

/** Credentials and options aside, two URLs on one host, port and database are one database. */
function databaseOf(url) {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || '5432'}${pathname}`;
}

const databaseNameOf = (url) => decodeURIComponent(new URL(url).pathname.slice(1));

function refuse(reason) {
  console.error(`test:db: ${reason}`);
  process.exit(1);
}

function run(command, args, env) {
  try {
    execFileSync(command, args, { cwd: ROOT, env, stdio: 'inherit' });
  } catch (error) {
    process.exit(error.status ?? 1);
  }
}

const testUrl = resolve('TEST_DATABASE_URL');
const devUrl = resolve('DATABASE_URL');

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

run(
  join(ROOT, 'node_modules/.bin/prisma'),
  ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
  env,
);
run('pnpm', ['--filter', '@iace/api', 'test:db'], env);
