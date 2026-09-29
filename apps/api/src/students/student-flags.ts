import { type Prisma } from '@prisma/client';
import { READINESS_FIELDS, type ReadinessFlag } from '@iace/contracts';

/** The `StudentProfile` columns an uploaded file lands in. */
export type ProfileDocumentColumn = 'photoUrl' | 'tenthMarksheetUrl';

/** `readinessOf` as a roster filter. Not-null is its whole rule here, because every writer clears a blank answer to null. */
export function readinessWhere(flag: ReadinessFlag, wanted: boolean): Prisma.StudentWhereInput {
  const answered: Prisma.StudentProfileWhereInput = Object.fromEntries(
    READINESS_FIELDS[flag].map((field) => [field, { not: null }]),
  );
  const ready: Prisma.StudentWhereInput = { profile: { is: answered } };
  return wanted ? ready : { NOT: ready };
}
