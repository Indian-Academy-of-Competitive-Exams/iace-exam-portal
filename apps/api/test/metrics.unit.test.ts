import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import { AppException, ErrorCodes } from '@iace/contracts';
import { MetricsController } from '../src/common/metrics/metrics.controller';
import type { MetricsService } from '../src/common/metrics/metrics.service';
import { FakeConfig } from './support/fakes';

const SCRAPED = 'iace_live_attempts 3\n';

/** Enough of an express response to record what the scraper would have been handed. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  let body: unknown;
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    send: (payload: unknown) => {
      body = payload;
    },
  };
  return { response: response as unknown as Response, headers, sent: () => body };
}

const controller = (env: Record<string, unknown>) =>
  new MetricsController(
    { scrape: () => Promise.resolve(SCRAPED) } as unknown as MetricsService,
    new FakeConfig(env).asService(),
  );

describe('GET /metrics', () => {
  /** Live attempt counts and error rates are operational intelligence, not a public fact. */
  it('refuses a scraper that does not carry the token', async () => {
    const guarded = controller({ METRICS_TOKEN: 'scraper-token' });

    for (const header of [undefined, 'Bearer wrong', 'scraper-token']) {
      const { response, sent } = fakeResponse();

      await assert.rejects(
        guarded.scrape(response, header),
        (error: unknown) => {
          assert.ok(AppException.is(error));
          assert.equal(error.code, ErrorCodes.UNAUTHENTICATED);
          return true;
        },
        String(header),
      );
      assert.equal(sent(), undefined, 'nothing may be written before the token is checked');
    }
  });

  /** Prometheus parses lines, not the success envelope every other route is wrapped in. */
  it('answers the scraper that does, as text and not as an envelope', async () => {
    const { response, headers, sent } = fakeResponse();

    await controller({ METRICS_TOKEN: 'scraper-token' }).scrape(response, 'Bearer scraper-token');

    assert.equal(sent(), SCRAPED);
    assert.match(headers['content-type'] ?? '', /^text\/plain; version=0\.0\.4/);
  });

  /** The schema has already refused an unset token in production, so this is only ever dev. */
  it('answers anybody when no token is configured', async () => {
    const { response, sent } = fakeResponse();

    await controller({}).scrape(response, undefined);

    assert.equal(sent(), SCRAPED);
  });
});
