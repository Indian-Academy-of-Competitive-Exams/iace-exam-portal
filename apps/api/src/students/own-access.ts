import { type Prisma } from '@prisma/client';

/** A student's own way into a series, the resolver's rule read from their side: a program, an event, a grant, or a course at a branch. FREE reaches everyone, so it is nobody's own. */
export const HOLDS_OWN_ACCESS: Prisma.StudentWhereInput = {
  OR: [
    { programs: { isEmpty: false } },
    { currentBranchId: { not: null }, enrolledCourses: { isEmpty: false } },
    { grants: { some: {} } },
    { eventCandidacies: { some: {} } },
  ],
};
