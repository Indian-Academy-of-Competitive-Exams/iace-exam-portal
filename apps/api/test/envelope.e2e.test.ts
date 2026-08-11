import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { RequestIdMiddleware, REQUEST_ID_HEADER } from '../src/common/request-id';
import { ZodBody } from '../src/common/zod-validation.pipe';

/**
 * End to end over real HTTP, through a real Nest app wired exactly the way
 * AppModule wires the envelope. The point is the wiring: that a handler which
 * knows nothing about the envelope still answers inside it, and that a thrown
 * error never escapes as anything else.
 *
 * The probe module stands in for AppModule so the test needs no database,
 * Redis or S3 — only the three pieces under test.
 */

const bodySchema = z.object({ mobile: z.string().min(10, 'Enter a valid 10-digit mobile number') });

@Controller('probe')
class ProbeController {
  @Get('plain')
  plain() {
    return { hello: 'world' };
  }

  @Get('list')
  list() {
    return { items: ['a', 'b'], page: 2, pageSize: 2, total: 7 };
  }

  @Get('nothing')
  nothing(): void {
    // returns undefined
  }

  @Get('app-exception')
  appException(): never {
    throw new AppException(ErrorCodes.OTP_INVALID, 'Incorrect code', {
      fieldErrors: { code: ['Incorrect code'] },
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('postgres://iace:hunter2@10.0.0.7:5432');
  }

  @Post('validate')
  validate(@Body(new ZodBody(bodySchema)) body: z.infer<typeof bodySchema>) {
    return body;
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

describe('response envelope (e2e)', () => {
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

  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { response, body: (await response.json()) as Record<string, unknown> };
  };

  it('wraps a 200 in { success, data, meta.requestId }', async () => {
    const { response, body } = await call('/probe/plain');

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { hello: 'world' });
    assert.match((body.meta as { requestId: string }).requestId, /^[0-9a-f-]{36}$/);
  });

  it('echoes the request id in the header and the body, and they match', async () => {
    const { response, body } = await call('/probe/plain');
    const header = response.headers.get(REQUEST_ID_HEADER);

    assert.ok(header);
    assert.equal((body.meta as { requestId: string }).requestId, header);
  });

  it('honours an inbound request id so a trace survives the hop', async () => {
    const { body } = await call('/probe/plain', {
      headers: { [REQUEST_ID_HEADER]: 'trace-abc-12345678' },
    });
    assert.equal((body.meta as { requestId: string }).requestId, 'trace-abc-12345678');
  });

  it('moves list counts into meta', async () => {
    const { body } = await call('/probe/list');

    assert.deepEqual(body.data, ['a', 'b']);
    assert.deepEqual(body.meta, {
      requestId: (body.meta as { requestId: string }).requestId,
      page: 2,
      pageSize: 2,
      total: 7,
    });
  });

  it('still sends a body for a handler that returns nothing', async () => {
    const { response, body } = await call('/probe/nothing');

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data, null);
  });

  it('answers a thrown AppException with its code, status and fieldErrors', async () => {
    const { response, body } = await call('/probe/app-exception');

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
    assert.deepEqual(body.error, {
      code: 'OTP_INVALID',
      message: 'Incorrect code',
      fieldErrors: { code: ['Incorrect code'] },
    });
    assert.ok((body.meta as { requestId: string }).requestId);
  });

  it('returns VALIDATION_ERROR + fieldErrors for a bad body', async () => {
    const { response, body } = await call('/probe/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '99' }),
    });

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, 'VALIDATION_ERROR');
    assert.deepEqual((body.error as { fieldErrors: unknown }).fieldErrors, {
      mobile: ['Enter a valid 10-digit mobile number'],
    });
  });

  it('reports an unhandled error as INTERNAL and leaks nothing', async () => {
    const { response, body } = await call('/probe/boom');

    assert.equal(response.status, 500);
    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, 'INTERNAL');
    assert.ok(!JSON.stringify(body).includes('hunter2'));
    assert.ok(!JSON.stringify(body).includes('postgres://'));
  });

  it("wraps the framework's own 404 — an unrouted path is in the envelope too", async () => {
    const { response, body } = await call('/no-such-route');

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, 'NOT_FOUND');
    assert.ok((body.meta as { requestId: string }).requestId);
  });
});
