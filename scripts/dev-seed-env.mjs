/**
 * DEV-ONLY: imported first by every dev seed. Loads .env beneath whatever the shell already set, then
 * refuses a DATABASE_URL that does not look local unless FORCE_DEV_SEED=1.
 */
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env — rely on the shell.
}

const url = process.env.DATABASE_URL ?? '';
const looksLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)[:/]/.test(url);
if (!looksLocal && process.env.FORCE_DEV_SEED !== '1') {
  console.error(
    `Refusing to run: DATABASE_URL does not look local.\n  ${url || '(unset)'}\n  Set FORCE_DEV_SEED=1 to override on a disposable database.`,
  );
  process.exit(1);
}
