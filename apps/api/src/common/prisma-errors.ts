import { Prisma } from '@prisma/client';

/** The Prisma failures that mean something to a user rather than to us. Every other P-code is our bug and is reported as INTERNAL. https://www.prisma.io/docs/orm/reference/error-reference */
export const PRISMA_ERROR_CODES = {
  UNIQUE_CONSTRAINT_VIOLATION: 'P2002',
  RECORD_NOT_FOUND: 'P2025',
  // Ids are uuid columns, so a malformed one is refused here rather than matching no row.
  MALFORMED_VALUE: 'P2023',
  RAW_QUERY_FAILED: 'P2010',
} as const;

/** Postgres says it in `meta.code`; a raw query reports the database's code, not Prisma's. */
export const POSTGRES_ERROR_CODES = {
  MALFORMED_VALUE: '22P02',
  DEADLOCK: '40P01',
} as const;

/** A malformed id, whichever way it reached Postgres: no row can have it, so nothing was found. */
export function isMalformedValue(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.code === PRISMA_ERROR_CODES.MALFORMED_VALUE) return true;
  return (
    error.code === PRISMA_ERROR_CODES.RAW_QUERY_FAILED &&
    (error.meta as { code?: unknown } | undefined)?.code === POSTGRES_ERROR_CODES.MALFORMED_VALUE
  );
}

/** Postgres killed one of two crossing transactions; only a raw query carries the code in `meta`. */
export function isDeadlock(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes(POSTGRES_ERROR_CODES.DEADLOCK);
  }
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.meta as { code?: unknown } | undefined)?.code === POSTGRES_ERROR_CODES.DEADLOCK
  );
}

/** A write lost a race with an identical one. The partial uniques this repo declares by hand in a migration are invisible to Prisma, so the thrown code is the only way a service learns of them. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION
  );
}
