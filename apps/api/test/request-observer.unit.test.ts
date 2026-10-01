import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { RequestObserverMiddleware } from '../src/common/metrics/request-observer.middleware';
import { type MetricsService } from '../src/common/metrics/metrics.service';

interface Observed {
  method: string;
  route: string;
  status: number;
  seconds: number;
}

let observed: Observed[] = [];

const metrics = {
  observeRequest: (method: string, route: string, status: number, seconds: number) =>
    void observed.push({ method, route, status, seconds }),
} as unknown as MetricsService;

/** Express gives the middleware a response that is an EventEmitter; `finish` is all this reads off it. */
function serve(request: Record<string, unknown>, status: number): void {
  const response = Object.assign(new EventEmitter(), { statusCode: status });
  let passedOn = false;

  new RequestObserverMiddleware(metrics).use(request as never, response as never, () => {
    passedOn = true;
  });

  assert.equal(passedOn, true, 'the request must continue regardless');
  response.emit('finish');
}

beforeEach(() => {
  observed = [];
});

describe('RequestObserverMiddleware', () => {
  it('counts a call by its route PATTERN, so 5,000 ids are not 5,000 series', () => {
    serve(
      { method: 'GET', route: { path: '/me/attempts/:id' }, startedAt: process.hrtime.bigint() },
      200,
    );

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.route, '/me/attempts/:id');
    assert.equal(observed[0]?.method, 'GET');
    assert.equal(observed[0]?.status, 200);
  });

  /** The gap this exists to close: a guard throws before any interceptor, so nothing used to count a 401, 403 or 429. */
  it('counts a refusal the same way it counts a success', () => {
    for (const status of [401, 403, 429]) {
      serve({ method: 'GET', route: { path: '/admin/students' }, startedAt: 0n }, status);
    }

    assert.deepEqual(
      observed.map((entry) => entry.status),
      [401, 403, 429],
    );
  });

  /** A body-parser refusal is thrown before a route is chosen, so there is no pattern to name. */
  it('names an unrouted request rather than inventing a pattern', () => {
    serve({ method: 'POST', startedAt: process.hrtime.bigint() }, 413);

    assert.equal(observed[0]?.route, 'unmatched');
    assert.equal(observed[0]?.status, 413);
  });

  it('reports a duration in seconds, which is what a Prometheus scrape assumes', () => {
    const startedAt = process.hrtime.bigint() - 250_000_000n;
    serve({ method: 'GET', route: { path: '/health' }, startedAt }, 200);

    assert.ok(observed[0] !== undefined);
    assert.ok(observed[0].seconds >= 0.24, `too short: ${observed[0].seconds}`);
    assert.ok(observed[0].seconds < 1, `too long: ${observed[0].seconds}`);
  });

  it('counts each response once, never twice', () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    const request = { method: 'GET', route: { path: '/probe' }, startedAt: 0n };

    new RequestObserverMiddleware(metrics).use(request as never, response as never, () => {});
    response.emit('finish');

    assert.equal(observed.length, 1);
  });
});
