import { type PipeTransform } from '@nestjs/common';
import { AppException, ErrorCodes } from '@iace/contracts';
import { type ZodType } from 'zod';
import { fieldErrorsFrom } from './all-exceptions.filter';

/**
 * Validates a request body against a schema from `@iace/contracts`, so the API
 * and both frontends enforce the exact same rules from one definition.
 *
 * A failure becomes a VALIDATION_ERROR carrying `fieldErrors` keyed by field
 * name, which the login forms hand straight to react-hook-form.
 *
 * Usage: `@Body(new ZodBody(requestStudentOtpSchema)) body: RequestStudentOtpBody`
 */
export class ZodBody<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Some of the details are not valid', {
      fieldErrors: fieldErrorsFrom(result.error),
    });
  }
}

/**
 * The same, for `@Query()`. Query strings arrive as strings, so the schema must
 * coerce — see `paginationQuerySchema`, where page and pageSize are numbers on
 * the far side of a `z.coerce`.
 */
export class ZodQuery<TOut> extends ZodBody<TOut> {}
