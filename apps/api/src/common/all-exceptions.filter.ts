import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { type Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ERROR_CODE_STATUS,
  errorCodeForStatus,
  type ApiError,
  type ApiFailure,
} from '@iace/contracts';
import { ensureRequestId, type RequestWithId } from './request-id';

/**
 * The single exit for everything thrown anywhere in the API — controllers,
 * guards, pipes, Prisma, a stray TypeError. `@Catch()` with no argument means
 * no exception can route around it, which is what makes the failure envelope a
 * guarantee rather than a convention.
 *
 * Two rules:
 *   - the client gets a stable `code` and a message safe to display;
 *   - anything we did not anticipate is logged in full, with the requestId, and
 *     reported as a bare INTERNAL. Stack traces, SQL and driver text never
 *     cross the wire.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Request');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Non-HTTP contexts (queue workers) have no response to write to.
    if (host.getType() !== 'http') throw exception;

    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const requestId = ensureRequestId(request);

    const { status, error } = translate(exception);
    this.log(exception, { status, error, requestId, request });

    const body: ApiFailure = { success: false, error, meta: { requestId } };
    response.status(status).json(body);
  }

  private log(
    exception: unknown,
    context: { status: number; error: ApiError; requestId: string; request: RequestWithId },
  ): void {
    const { status, error, requestId, request } = context;
    const where = `${request.method} ${request.originalUrl ?? request.url}`;
    const line = `${where} → ${status} ${error.code} [${requestId}]`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // The only place the real cause exists: the response deliberately does not
      // carry it, so losing it here would mean losing it entirely.
      this.logger.error(line, exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    this.logger.debug(`${line} ${error.message}`);
  }
}

interface Translated {
  status: number;
  error: ApiError;
}

/** Every kind of thrown value, mapped to exactly one envelope error. */
function translate(exception: unknown): Translated {
  // 1. Ours — already carries the code and status it wants.
  if (AppException.is(exception)) {
    return { status: exception.httpStatus, error: exception.toApiError() };
  }

  // 2. A schema rejected the input. Field-level messages feed the form directly.
  if (exception instanceof ZodError) {
    return {
      status: ERROR_CODE_STATUS.VALIDATION_ERROR,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some of the details are not valid',
        fieldErrors: fieldErrorsFrom(exception),
      },
    };
  }

  // 3. Prisma's constraint failures are the two that mean something to a user;
  //    the rest are our bug, not theirs.
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      return {
        status: ERROR_CODE_STATUS.CONFLICT,
        error: { code: 'CONFLICT', message: 'That already exists', details: targetOf(exception) },
      };
    }
    if (exception.code === 'P2025') {
      return {
        status: ERROR_CODE_STATUS.NOT_FOUND,
        error: { code: 'NOT_FOUND', message: 'Not found' },
      };
    }
    return internal();
  }

  // 4. Nest's own exceptions — framework 404s, guards that predate AppException.
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return internal();
    return {
      status,
      error: { code: errorCodeForStatus(status), message: messageOf(exception) },
    };
  }

  // 5. Anything else is a bug.
  return internal();
}

function internal(): Translated {
  return {
    status: ERROR_CODE_STATUS.INTERNAL,
    // Generic on purpose: an unhandled error's message is as likely to be a
    // connection string as anything a user could act on.
    error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
  };
}

/**
 * The flattened form of a ZodError: keyed by the first path segment, which is
 * exactly the field name react-hook-form registers. Issues about the body as a
 * whole have no path and land under `_`, where a form shows them as a summary.
 *
 * This is `z.flattenError`'s grouping, written out because that helper loses
 * its types on an unparameterised `ZodError`.
 */
export function fieldErrorsFrom(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : '_';
    (fieldErrors[field] ??= []).push(issue.message);
  }

  return fieldErrors;
}

function messageOf(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === 'string') return payload;

  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return exception.message;
}

/** The column(s) that collided, so a form can point at the right field. */
function targetOf(exception: Prisma.PrismaClientKnownRequestError): unknown {
  const target = exception.meta?.target;
  return Array.isArray(target) || typeof target === 'string' ? { target } : undefined;
}
