import { Module } from '@nestjs/common';
import {
  ThrottlerModule,
  minutes,
  type ThrottlerModuleOptions,
  type ThrottlerOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { type Request } from 'express';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';
import { RedisModule } from '../../redis/redis.module';
import { RedisService } from '../../redis/redis.service';
import { type AuthenticatedUser } from '../security';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { trackerFor } from './rate-limit';
import { RATE_LIMITS, notMarkedWith, type RateLimitName } from './rate-limits';

export type RateLimitsPerMinute = Record<'default' | RateLimitName, number>;

/** The whole policy in one function, so a test can exercise the real names and the real skipping. */
export function throttlerOptionsFrom(
  limits: RateLimitsPerMinute,
  storage: ThrottlerStorage,
): ThrottlerModuleOptions {
  const named = (name: RateLimitName): ThrottlerOptions => ({
    name,
    ttl: minutes(1),
    limit: limits[name],
    skipIf: notMarkedWith(name),
  });

  return {
    throttlers: [
      { ttl: minutes(1), limit: limits.default },
      named(RATE_LIMITS.AUTH),
      named(RATE_LIMITS.SITTING),
      named(RATE_LIMITS.SHARE),
    ],
    getTracker: (request: Record<string, unknown>) =>
      trackerFor(
        (request as { user?: AuthenticatedUser }).user,
        (request as unknown as Request).ip,
      ),
    errorMessage: 'Too many requests — please wait a moment',
    storage,
  };
}

/** `app.module` registers the guard last, so `request.user` exists and a caller is counted as themselves. */
@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule, RedisModule],
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) =>
        throttlerOptionsFrom(
          {
            default: config.get('RATE_LIMIT_DEFAULT_PER_MIN'),
            auth: config.get('RATE_LIMIT_AUTH_PER_MIN'),
            sitting: config.get('RATE_LIMIT_SITTING_PER_MIN'),
            share: config.get('RATE_LIMIT_SHARE_PER_MIN'),
          },
          new RedisThrottlerStorage(redis),
        ),
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottlingModule {}
