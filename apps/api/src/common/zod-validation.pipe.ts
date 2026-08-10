import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';

/**
 * Validates a request body against a schema from `@iace/contracts`, so the API
 * and both frontends enforce the exact same rules from one definition.
 *
 * Usage: `@Body(new ZodBody(requestStudentOtpSchema)) body: RequestStudentOtpBody`
 */
export class ZodBody<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
      ),
    );
  }
}
