#!/usr/bin/env node
/** Fails when prisma/schema.prisma and the migration history disagree; `--shadow-database-url` must be literal (Prisma won't read it from .env, and the shell expands `$SHADOW_DATABASE_URL` empty → P1013), so .env is parsed — not sourced — here. */
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
