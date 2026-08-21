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
  FORM_LEVEL_FIELD,
  ErrorCodes,
  ERROR_CODE_STATUS,
  errorCodeForStatus,
  type ApiError,
  type ApiFailure,
} from '@iace/contracts';
import { ensureRequestId, type RequestWithId } from './request-id';
import { PRISMA_ERROR_CODES } from './prisma-errors';

/**
 * The single exit for everything thrown anywhere in the API — controllers, guards, pipes, Prisma,
 * a stray TypeError.
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
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Some of the details are not valid',
        fieldErrors: fieldErrorsFrom(exception),
      },
    };
  }

  // 3. Prisma's constraint failures are the two that mean something to a user;
  //    the rest are our bug, not theirs.
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION) {
      return {
        status: ERROR_CODE_STATUS.CONFLICT,
        error: {
          code: ErrorCodes.CONFLICT,
          message: 'That already exists',
          details: targetOf(exception),
        },
      };
    }
    if (exception.code === PRISMA_ERROR_CODES.RECORD_NOT_FOUND) {
      return {
        status: ERROR_CODE_STATUS.NOT_FOUND,
        error: { code: ErrorCodes.NOT_FOUND, message: 'Not found' },
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

  // 5.
  const status = expressStatusOf(exception);
  if (status !== null) {
    return {
      status,
      error: {
        code: errorCodeForStatus(status),
        message: CLIENT_ERROR_MESSAGES[status] ?? DEFAULT_CLIENT_ERROR,
      },
    };
  }

  // 6. Anything else is a bug.
  return internal();
}

/**
 * The numeric status an Express middleware error carries, if it is a client error. 5xx is
 * deliberately excluded: a middleware failing on our side is our bug and belongs in the INTERNAL
 * path, stack and all.
 */
function expressStatusOf(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;

  return typeof value === 'number' && value >= 400 && value < 500 ? value : null;
}

const DEFAULT_CLIENT_ERROR = 'The request could not be accepted';

/** Wording we choose ourselves — a middleware's own message is not ours to trust. */
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'The request was too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'That content type is not supported',
};

function internal(): Translated {
  return {
    status: ERROR_CODE_STATUS.INTERNAL,
    // Generic on purpose: an unhandled error's message is as likely to be a
    // connection string as anything a user could act on.
    error: { code: ErrorCodes.INTERNAL, message: 'Something went wrong. Please try again.' },
  };
}

/** A ZodError keyed by its FULL dotted path — `profile.dob`, not `profile`. */
export function fieldErrorsFrom(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : FORM_LEVEL_FIELD;
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
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
