import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { MetricsController } from '../src/common/metrics/metrics.controller';
import type { MetricsService } from '../src/common/metrics/metrics.service';
import { FakeConfig } from './support/fakes';

const scraped = 'iace_live_attempts 3\n';

const controller = (env: Record<string, unknown>) =>
  new MetricsController(
    { scrape: () => Promise.resolve(scraped) } as unknown as MetricsService,
    new FakeConfig(env).asService(),
  );

describe('GET /metrics', () => {
  /** Live attempt counts and error rates are operational intelligence, not a public fact. */
  it('refuses a scraper that does not carry the token', async () => {
    const guarded = controller({ METRICS_TOKEN: 'scraper-token' });

    for (const header of [undefined, 'Bearer wrong', 'scraper-token']) {
      await assert.rejects(
        Promise.resolve().then(() => guarded.scrape(header)),
        (error: unknown) => {
          assert.ok(AppException.is(error));
          assert.equal(error.code, ErrorCodes.UNAUTHENTICATED);
          return true;
        },
        String(header),
      );
    }
  });

  it('answers the scraper that does', async () => {
    const guarded = controller({ METRICS_TOKEN: 'scraper-token' });

    assert.equal(await guarded.scrape('Bearer scraper-token'), scraped);
  });

  /** The schema has already refused an unset token in production, so this is only ever dev. */
  it('answers anybody when no token is configured', async () => {
    assert.equal(await controller({}).scrape(undefined), scraped);
  });
});
