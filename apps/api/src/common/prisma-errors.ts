import { Prisma } from '@prisma/client';

/**
 * The Prisma failures that mean something to a user rather than to us. Every other P-code is our
 * bug and is reported as INTERNAL. https://www.prisma.io/docs/orm/reference/error-reference
 */
export const PRISMA_ERROR_CODES = {
  UNIQUE_CONSTRAINT_VIOLATION: 'P2002',
  RECORD_NOT_FOUND: 'P2025',
  /** The migration that creates it has not been deployed to THIS database yet. */
  TABLE_NOT_FOUND: 'P2021',
} as const;

/**
 * A write lost a race with an identical one. The partial uniques this repo declares by hand in a
 * migration are invisible to Prisma, so the thrown code is the only way a service learns of them.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION
  );
}

/** A table a not-yet-deployed migration creates, so an optional read can stand down rather than 500. */
export function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_ERROR_CODES.TABLE_NOT_FOUND
  );
}
