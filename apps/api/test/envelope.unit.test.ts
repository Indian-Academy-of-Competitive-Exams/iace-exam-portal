import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { of, firstValueFrom } from 'rxjs';
import {
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExecutionContext,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppException, ErrorCodes, apiFailureSchema, apiSuccessSchema } from '@iace/contracts';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ZodBody } from '../src/common/zod-validation.pipe';

// Note the asymmetry below: errors are CONSTRUCTED with `ErrorCodes.X`, but assertions compare
// against the literal string on purpose.

function httpHost(request: Record<string, unknown> = {}) {
  const sent = { status: 0, body: undefined as unknown };
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  };
  return { host: host as unknown as ArgumentsHost & ExecutionContext, sent, request };
}

function capture(filter: AllExceptionsFilter, exception: unknown) {
  const { host, sent, request } = httpHost({ method: 'POST', url: '/auth/student/login' });
  filter.catch(exception, host);

  const parsed = apiFailureSchema.safeParse(sent.body);
  assert.ok(parsed.success, `not a failure envelope: ${JSON.stringify(sent.body)}`);
  return { status: sent.status, failure: parsed.data, request };
}

// ---------------------------------------------------------------------------

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  const run = async (payload: unknown, request: Record<string, unknown> = {}) => {
    const { host } = httpHost(request);
    return firstValueFrom(interceptor.intercept(host, { handle: () => of(payload) }));
  };

  it('wraps a plain return in the success envelope', async () => {
    const result = await run({ sent: true });

    const parsed = apiSuccessSchema(z.object({ sent: z.boolean() })).safeParse(result);
    assert.ok(parsed.success, JSON.stringify(result));
    assert.equal(parsed.data.success, true);
    assert.deepEqual(parsed.data.data, { sent: true });
    assert.match(parsed.data.meta.requestId, /^[0-9a-f-]{36}$/);
  });

  it('reuses the request id the middleware stamped', async () => {
    const result = (await run('anything', { requestId: 'req-from-middleware' })) as {
      meta: { requestId: string };
    };
    assert.equal(result.meta.requestId, 'req-from-middleware');
  });

  it('splits a paginated return into data + meta', async () => {
    const result = (await run({ items: ['a', 'b'], page: 2, pageSize: 10, total: 42 })) as {
      data: string[];
      meta: Record<string, unknown>;
    };

    assert.deepEqual(result.data, ['a', 'b']);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.meta.total, 42);
  });

  it('gives a void handler an explicit null rather than a missing key', async () => {
    const result = (await run(undefined)) as { data: unknown };
    assert.equal(result.data, null);
  });
});

// ---------------------------------------------------------------------------

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('passes an AppException through with its code and status', () => {
    const { status, failure } = capture(
      filter,
      new AppException(ErrorCodes.PIN_LOCKED, 'Try again in 15 minute(s)'),
    );

    assert.equal(status, 429);
    assert.equal(failure.error.code, 'PIN_LOCKED');
    assert.equal(failure.error.message, 'Try again in 15 minute(s)');
    assert.equal(failure.success, false);
    assert.ok(failure.meta.requestId);
  });

  it('carries fieldErrors from a validation failure', () => {
    const { status, failure } = capture(
      filter,
      new AppException(ErrorCodes.VALIDATION_ERROR, 'Some of the details are not valid', {
        fieldErrors: { mobile: ['Enter a valid 10-digit mobile number'] },
      }),
    );

    assert.equal(status, 400);
    assert.equal(failure.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(failure.error.fieldErrors, {
      mobile: ['Enter a valid 10-digit mobile number'],
    });
  });

  it('turns a raw ZodError into VALIDATION_ERROR with per-field messages', () => {
    const schema = z.object({ mobile: z.string(), pin: z.string() });
    const result = schema.safeParse({ mobile: 42 });
    assert.ok(!result.success);

    const { status, failure } = capture(filter, result.error);

    assert.equal(status, 400);
    assert.equal(failure.error.code, 'VALIDATION_ERROR');
    assert.ok(failure.error.fieldErrors?.mobile?.[0]);
    assert.ok(failure.error.fieldErrors?.pin?.[0]);
  });

  it('maps Prisma P2002 to CONFLICT and P2025 to NOT_FOUND', () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['mobile'] },
    });
    const missing = new Prisma.PrismaClientKnownRequestError('gone', {
      code: 'P2025',
      clientVersion: 'test',
    });

    assert.equal(capture(filter, conflict).status, 409);
    assert.equal(capture(filter, conflict).failure.error.code, 'CONFLICT');
    assert.equal(capture(filter, missing).status, 404);
    assert.equal(capture(filter, missing).failure.error.code, 'NOT_FOUND');
  });

  it('maps a Nest HttpException by status', () => {
    const { status, failure } = capture(filter, new HttpException('Nope', HttpStatus.NOT_FOUND));

    assert.equal(status, 404);
    assert.equal(failure.error.code, 'NOT_FOUND');
    assert.equal(failure.error.message, 'Nope');
  });

  it('never leaks an unexpected error, and still answers in the envelope', () => {
    const { status, failure } = capture(
      filter,
      new Error('connect ECONNREFUSED 10.0.0.7:5432 password=hunter2'),
    );

    assert.equal(status, 500);
    assert.equal(failure.error.code, 'INTERNAL');
    assert.equal(failure.error.message, 'Something went wrong. Please try again.');
    assert.ok(!JSON.stringify(failure).includes('hunter2'));
    assert.ok(!JSON.stringify(failure).includes('5432'));
  });

  it('maps an Express-style client error instead of blaming itself', () => {
    // What body-parser throws for an oversized body: a plain Error with a numeric status, not an
    // HttpException.
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    });

    const { status, failure } = capture(filter, tooLarge);

    assert.equal(status, 413);
    assert.equal(failure.error.code, 'VALIDATION_ERROR');
    assert.equal(failure.error.message, 'The request was too large');
  });

  it('still treats a middleware 5xx as our bug, not the client problem', () => {
    const upstream = Object.assign(new Error('socket hang up'), { status: 502 });

    const { status, failure } = capture(filter, upstream);

    assert.equal(status, 500);
    assert.equal(failure.error.code, 'INTERNAL');
    assert.ok(!JSON.stringify(failure).includes('socket hang up'));
  });

  it('mints a request id even when the middleware never ran', () => {
    const { failure } = capture(filter, new AppException(ErrorCodes.NOT_FOUND));
    assert.match(failure.meta.requestId, /^[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------

describe('ZodBody', () => {
  it('throws VALIDATION_ERROR with fieldErrors keyed by field name', () => {
    const pipe = new ZodBody(z.object({ mobile: z.string().min(10, 'Too short') }));

    assert.throws(
      () => pipe.transform({ mobile: '99' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.equal(error.httpStatus, 400);
        assert.deepEqual(error.fieldErrors, { mobile: ['Too short'] });
        return true;
      },
    );
  });

  it('returns the parsed value on success', () => {
    const pipe = new ZodBody(z.object({ mobile: z.string() }));
    assert.deepEqual(pipe.transform({ mobile: '9876543210' }), { mobile: '9876543210' });
  });
});
