import { type Prisma } from '@prisma/client';
import { STUDENT_SORTS, type AnnouncementAudience } from '@iace/contracts';
import { studentWhere } from '../students';

/** Live students only: a soft-deleted or anonymised row is not somebody to announce anything to. */
export function cohortWhere(audience: AnnouncementAudience): Prisma.StudentWhereInput {
  return {
    AND: [
      studentWhere({ ...audience, page: 1, pageSize: 1, sort: STUDENT_SORTS.RECENT }),
      { deletedAt: null },
    ],
  };
}

/** Who an announcement reached: its filter, among the students there were when it was sent. */
export function reachedBy(audience: AnnouncementAudience, sentAt: Date): Prisma.StudentWhereInput {
  return { AND: [cohortWhere(audience), { createdAt: { lte: sentAt } }] };
}
