import { Prisma } from '@prisma/client';
import { STUDENT_SORTS, type StudentListQuery, type StudentSort } from '@iace/contracts';
import { matchFilters } from '../common/match-filters';
import { everyTermMatches, termsOf } from '../common/search-terms';
import { HOLDS_OWN_ACCESS } from './own-access';
import { readinessWhere } from './student-flags';

/** Per number searched for, the students who once signed in with it. */
export type FormerHolders = ReadonlyMap<string, string[]>;

const NOBODY: FormerHolders = new Map();
const FULL_MOBILE = /^\d{10}$/;

/** Read ahead of the roster query: as ids, an old number costs the search none of its own indexes. */
export async function formerHoldersOf(
  prisma: Pick<Prisma.TransactionClient, 'studentMobileHistory'>,
  search: string | undefined,
): Promise<FormerHolders> {
  const numbers = termsOf(search).filter((term) => FULL_MOBILE.test(term));
  if (numbers.length === 0) return NOBODY;

  const rows = await prisma.studentMobileHistory.findMany({
    where: { mobile: { in: numbers } },
    select: { mobile: true, studentId: true },
  });
  const holders = new Map<string, string[]>();
  for (const row of rows)
    holders.set(row.mobile, [...(holders.get(row.mobile) ?? []), row.studentId]);
  return holders;
}

/** Turns the roster's filters into a Prisma query. */
export function studentWhere(
  query: StudentListQuery,
  formerHolders: FormerHolders = NOBODY,
): Prisma.StudentWhereInput {
  /** What the match toggle governs. */
  const chosen: Prisma.StudentWhereInput[] = [];
  const add = (condition: Prisma.StudentWhereInput) => chosen.push(condition);
  /** What narrows the roster whichever mode is chosen: the search box, and the caller's scope. */
  // Never `chosen`: under `match=any` an erased student would widen the result rather than narrow it.
  const always: Prisma.StudentWhereInput[] = [{ deletedAt: null }];

  if (query.isActive !== undefined) add({ isActive: query.isActive });
  if (query.isTestBlocked !== undefined) add({ isTestBlocked: query.isTestBlocked });
  if (query.preTestReady !== undefined) add(readinessWhere('preTestReady', query.preTestReady));
  if (query.profileCompleted !== undefined) {
    add(readinessWhere('profileCompleted', query.profileCompleted));
  }

  // The branch a student attends is a column of its own — no join.
  if (query.branchId) add({ currentBranchId: { in: query.branchId } });
  // Both are arrays on the student with a GIN index, so `hasSome` is the indexed read.
  if (query.programCode) add({ programs: { hasSome: query.programCode } });
  if (query.course) add({ enrolledCourses: { hasSome: query.course } });
  // A join, not an array: EventCandidate is indexed by studentId, so `some` reads that index.
  if (query.eventId) add({ eventCandidacies: { some: { eventId: { in: query.eventId } } } });
  if (query.noAccess !== undefined) add(ownAccessFilter(query.noAccess));

  if (query.hasDefaultPin !== undefined) add({ pinIsDefault: query.hasDefaultPin });

  if (query.q?.trim()) {
    always.push(
      everyTermMatches<Prisma.StudentWhereInput>(query.q, (term) => [
        { mobile: { contains: term } },
        { fullName: { contains: term, mode: 'insensitive' } },
        ...(formerHolders.has(term) ? [{ id: { in: formerHolders.get(term) } }] : []),
      ]),
    );
  }

  const and = matchFilters(always, chosen, query.match);

  // An empty AND is a valid Prisma filter, but returning {} keeps "no filters" obvious to anyone reading a log or a test.
  return and.length === 0 ? {} : { AND: and };
}

function ownAccessFilter(hasNoneOfTheirOwn: boolean): Prisma.StudentWhereInput {
  return hasNoneOfTheirOwn ? { NOT: HOLDS_OWN_ACCESS } : HOLDS_OWN_ACCESS;
}

/** Ordering, always tie-broken by id. */
export function studentOrderBy(sort: StudentSort): Prisma.StudentOrderByWithRelationInput[] {
  switch (sort) {
    case STUDENT_SORTS.OLDEST:
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case STUDENT_SORTS.NAME:
      // Nulls last: a student with no name yet is the least useful row to open an alphabetical list with.
      return [{ fullName: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    case STUDENT_SORTS.MOBILE:
      return [{ mobile: 'asc' }, { id: 'asc' }];
    case STUDENT_SORTS.RECENT:
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
