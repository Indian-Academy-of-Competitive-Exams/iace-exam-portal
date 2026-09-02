/**
 * Imported FIRST by main.ts, before anything else is required. Sentry patches
 * http and express as they load, so initialising it after the app module has
 * already pulled them in leaves it seeing nothing.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();

// Inert without a DSN, which is what makes this safe to import unconditionally.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // A mobile number or a PIN must never leave the building inside a stack frame.
    sendDefaultPii: false,
  });
}

export const sentryEnabled = Boolean(dsn);
