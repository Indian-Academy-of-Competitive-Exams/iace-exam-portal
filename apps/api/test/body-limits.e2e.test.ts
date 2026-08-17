import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import { Body, Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { IMPORT_ROUTE_PREFIX, registerBodyParsers } from '../src/common/body-parsers';
import { AppConfigService } from '../src/config/app-config.service';
import { FakeConfig } from './support/fakes';

/** Two limits, one path boundary. */

const DEFAULT_LIMIT = '4kb';
const IMPORT_LIMIT = '64kb';

@Controller()
class EchoController {
  @Post('ordinary')
  ordinary(@Body() body: { pad?: string }) {
    return { received: body.pad?.length ?? 0 };
  }

  @Post(`${IMPORT_ROUTE_PREFIX}/questions`)
  importQuestions(@Body() body: { pad?: string }) {
    return { received: body.pad?.length ?? 0 };
  }
}

@Module({
  controllers: [EchoController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: AppConfigService,
      useValue: new FakeConfig({
        BODY_LIMIT_DEFAULT: DEFAULT_LIMIT,
        BODY_LIMIT_IMPORT: IMPORT_LIMIT,
      }).asService(),
    },
  ],
})
class ProbeModule {}

describe('request body limits (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false, bodyParser: false });
    registerBodyParsers(app);
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

  it('refuses an oversized body on an ordinary route', async () => {
    const { status, body } = await post('/ordinary', 8 * 1024);

    assert.equal(status, 413);
    assert.equal(body.success, false);
    assert.equal((body.error as { code: string }).code, 'VALIDATION_ERROR');
    assert.equal((body.error as { message: string }).message, 'The request was too large');
  });

  it('accepts on the import path a body the ordinary limit would refuse', async () => {
    // The point of the whole feature: same server, same payload, different path.
    const { status, body } = await post(`${IMPORT_ROUTE_PREFIX}/questions`, 32 * 1024);

    assert.equal(status, 201);
    assert.deepEqual(body.data, { received: 32 * 1024 });
  });

  it('still caps the import path — larger, not unlimited', async () => {
    const { status, body } = await post(`${IMPORT_ROUTE_PREFIX}/questions`, 128 * 1024);

    assert.equal(status, 413);
    assert.equal((body.error as { code: string }).code, 'VALIDATION_ERROR');
  });

  it('answers a rejected body in the envelope, with a request id to trace it', async () => {
    // body-parser throws before Nest's middleware runs, so this is the case
    // where the filter has to mint the id itself.
    const { body } = await post('/ordinary', 8 * 1024);

    assert.ok((body.meta as { requestId: string }).requestId);
  });
});
