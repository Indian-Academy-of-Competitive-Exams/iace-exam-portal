import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';

/** One JSON limit for every route: uploads are multipart and carry their own ceiling. */

const BODY_LIMIT = '4kb';

@Controller()
class EchoController {
  @Post('ordinary')
  ordinary(@Body() body: { pad?: string }) {
    return { received: body.pad?.length ?? 0 };
  }
}

@Module({
  controllers: [EchoController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
class ProbeModule {}

describe('request body limits (e2e)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  before(async () => {
    // The same two lines main.ts runs, over the same filter and interceptor.
    app = await NestFactory.create<NestExpressApplication>(ProbeModule, {
      logger: false,
      bodyParser: false,
    });
    app.useBodyParser('json', { limit: BODY_LIMIT });
    app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  after(async () => {
    await app.close();
  });

  const post = async (path: string, padBytes: number) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(padBytes) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('accepts an ordinary small request', async () => {
    const { status, body } = await post('/ordinary', 1024);

    assert.equal(status, 201);
    assert.deepEqual(body.data, { received: 1024 });
  });

  it('refuses an oversized body', async () => {
    const { status, body } = await post('/ordinary', 8 * 1024);

    assert.equal(status, 413);
    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, 'VALIDATION_ERROR');
    assert.equal((body.error as { message: string }).message, 'The request was too large');
  });

  it('answers a rejected body in the envelope, with a request id to trace it', async () => {
    // body-parser throws before Nest's middleware runs, so this is the case where the filter has to mint the id itself.
    const { body } = await post('/ordinary', 8 * 1024);

    assert.ok((body.meta as { requestId: string }).requestId);
  });
});
