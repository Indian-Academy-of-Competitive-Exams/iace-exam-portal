import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { ErrorCodes } from '@iace/contracts';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { throttlerOptionsFrom } from '../src/common/throttling/throttling.module';
import { AuthRateLimit, ShareRateLimit } from '../src/common/throttling/rate-limits';
import { windowRecord } from '../src/common/throttling/rate-limit';

/** The real policy over a counting map, so the names, the skipping and the 429 envelope are all real. */
const counting = (): ThrottlerStorage => {
  const hits = new Map<string, number>();
  return {
    increment: async (key, ttl, limit, _block, name) => {
      const counter = `${name}:${key}`;
      const total = (hits.get(counter) ?? 0) + 1;
      hits.set(counter, total);
      return windowRecord(total, limit, ttl, ttl);
    },
  };
};

@Controller('probe')
class ProbeController {
  @AuthRateLimit()
  @Get('login')
  login() {
    return { ok: true };
  }

  @ShareRateLimit()
  @Get('report')
  report() {
    return { ok: true };
  }

  @Get('open')
  open() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot(
      throttlerOptionsFrom({ default: 50, auth: 2, sitting: 2, share: 3 }, counting()),
    ),
  ],
  controllers: [ProbeController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class ProbeModule {}

describe('rate limiting (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  after(async () => {
    await app.close();
  });

  const call = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('lets the allowance through and refuses the one after it', async () => {
    assert.equal((await call('/probe/login')).status, 200);
    assert.equal((await call('/probe/login')).status, 200);
    assert.equal((await call('/probe/login')).status, 429);
  });

  /** A 429 is not a special case for the client: it arrives as a code, like every other failure. */
  it('refuses in the envelope, with the code the SPA reacts to', async () => {
    const { body } = await call('/probe/login');

    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, ErrorCodes.RATE_LIMITED);
    assert.match((body.error as { message: string }).message, /Too many requests/);
    assert.ok((body.meta as { requestId: string }).requestId);
  });

  /** The whole point of naming them: exhausting one window must not close another. */
  it('counts a differently-marked route on its own allowance', async () => {
    for (let i = 0; i < 3; i += 1) assert.equal((await call('/probe/report')).status, 200);
    assert.equal((await call('/probe/report')).status, 429);
  });

  it('leaves an unmarked route on the generous default', async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await call('/probe/open')).status, 200);
  });
});
