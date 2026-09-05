import { Prisma } from '@prisma/client';
import { STUDENT_SORTS, type StudentListQuery, type StudentSort } from '@iace/contracts';
import { matchFilters } from '../common/match-filters';

/** Turns the roster's filters into a Prisma query. */
export function studentWhere(query: StudentListQuery): Prisma.StudentWhereInput {
  /** What the match toggle governs. */
  const chosen: Prisma.StudentWhereInput[] = [];
  const add = (condition: Prisma.StudentWhereInput) => chosen.push(condition);
  /** What narrows the roster whichever mode is chosen: the search box, and the caller's scope. */
  const always: Prisma.StudentWhereInput[] = [];

  if (query.isActive !== undefined) add({ isActive: query.isActive });
  if (query.isTestBlocked !== undefined) add({ isTestBlocked: query.isTestBlocked });
  if (query.preTestReady !== undefined) add({ preTestReady: query.preTestReady });
  if (query.profileCompleted !== undefined) add({ profileCompleted: query.profileCompleted });

  // The branch a student attends is a column of its own — no join.
  if (query.branchId) add({ currentBranchId: { in: query.branchId } });
  // Both are arrays on the student with a GIN index, so `hasSome` is the indexed read.
  if (query.programCode) add({ programs: { hasSome: query.programCode } });
  if (query.course) add({ enrolledCourses: { hasSome: query.course } });
  if (query.noAccess !== undefined) add(ownAccessFilter(query.noAccess));
  if (query.neverSignedIn !== undefined) add(signedInFilter(query.neverSignedIn));

  if (query.hasDefaultPin !== undefined) add({ pinIsDefault: query.hasDefaultPin });

  const search = query.q?.trim();
  if (search) {
    always.push({
      OR: [
        { mobile: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const and = matchFilters(always, chosen, query.match);

  // An empty AND is a valid Prisma filter, but returning {} keeps "no filters"
  // obvious to anyone reading a log or a test.
  return and.length === 0 ? {} : { AND: and };
}

/** What a student reaches a series by: an exam enrolment or a program. An explicit grant is
 *  a row of its own and is not counted here. */
function ownAccessFilter(hasNoneOfTheirOwn: boolean): Prisma.StudentWhereInput {
  const noneOfTheirOwn = {
    enrolledExams: { isEmpty: true },
    programs: { isEmpty: true },
  } satisfies Prisma.StudentWhereInput;
  return hasNoneOfTheirOwn ? noneOfTheirOwn : { NOT: noneOfTheirOwn };
}

/**
 * Matches `hasSignedIn` exactly — a PIN the institute set does not count, or the filter and the
 * badge beside it would disagree.
 */
function signedInFilter(neverSignedIn: boolean): Prisma.StudentWhereInput {
  return neverSignedIn
    ? { OR: [{ pinHash: null }, { pinIsDefault: true }] }
    : { pinHash: { not: null }, pinIsDefault: false };
}

/** Ordering, always tie-broken by id. */
export function studentOrderBy(sort: StudentSort): Prisma.StudentOrderByWithRelationInput[] {
  switch (sort) {
    case STUDENT_SORTS.OLDEST:
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case STUDENT_SORTS.NAME:
      // Nulls last: a student with no name yet is the least useful row to open
      // an alphabetical list with.
      return [{ fullName: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    case STUDENT_SORTS.MOBILE:
      return [{ mobile: 'asc' }, { id: 'asc' }];
    case STUDENT_SORTS.RECENT:
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
