#!/usr/bin/env node
/**
 * Fails when prisma/schema.prisma and the migration history disagree.
 *
 * `prisma migrate diff --from-migrations` insists on `--shadow-database-url` as
 * a flag — it will not read the datasource's shadowDatabaseUrl, and the flag is
 * expanded by the shell long before Prisma loads .env. Passing "$SHADOW_DATABASE_URL"
 * straight from an npm script therefore sends Prisma an empty string and it dies
 * with P1013 about a relative URL, which reads like a malformed connection string
 * rather than a missing one.
 *
 * So read the value here. .env is parsed rather than sourced: values in it
 * contain spaces, and `. .env` runs them as commands.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, envValue } from './test-database.mjs';

const VARIABLE = 'SHADOW_DATABASE_URL';

const shadowUrl = envValue(VARIABLE);

if (!shadowUrl) {
  console.error(
    `db:check: ${VARIABLE} is not set. Add it to .env — see .env.example.\n` +
      'It must point at a throwaway database: the check drops and recreates whatever it names.',
  );
  process.exit(1);
}

try {
  execFileSync(
    join(ROOT, 'node_modules/.bin/prisma'),
    [
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
} catch (error) {
  process.exit(error.status ?? 1);
}
