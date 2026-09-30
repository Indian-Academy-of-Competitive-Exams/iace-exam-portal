/**
 * The one place stdout's shape and volume are decided, off process.env because this runs before
 * the config module exists. Production is JSON for a shipper, and drops debug so the per-request
 * line in MetricsInterceptor stays out of a live event. LOG_LEVEL overrides either, in
 * filterLogLevels' vocabulary: '>=warn', '>debug', 'log,error', or one level.
 */
import { ConsoleLogger, filterLogLevels } from '@nestjs/common';
import { NODE_ENVS } from '../config/env.schema';

export const LOG_LEVEL_DEFAULTS = {
  PRODUCTION: '>=log',
  OTHER: '>=debug',
} as const;

export function appLogger(): ConsoleLogger {
  const production = process.env.NODE_ENV === NODE_ENVS.PRODUCTION;
  const chosen =
    process.env.LOG_LEVEL?.trim() ||
    (production ? LOG_LEVEL_DEFAULTS.PRODUCTION : LOG_LEVEL_DEFAULTS.OTHER);

  return new ConsoleLogger({ json: production, logLevels: filterLogLevels(chosen) });
}
