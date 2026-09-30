import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Imported FIRST by main.ts: instrument.ts reads SENTRY_DSN as it loads, and an import is hoisted above any statement. */
const found = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(
  existsSync,
);

// Absent in production, where compose puts the whole environment in the process already.
if (found) process.loadEnvFile(found);
