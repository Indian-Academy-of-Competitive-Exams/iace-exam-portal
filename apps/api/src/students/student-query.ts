import { Prisma } from '@prisma/client';
import {
  GROUP_REACH,
  STUDENT_SORTS,
  groupReach,
  type GroupType,
  type StudentListQuery,
  type StudentSort,
} from '@iace/contracts';

/** Enough of a group to know how it reaches its students. */
export interface GroupAccessRef {
  id: string;
  type: GroupType;
  examType: string | null;
}

/** Turns the roster's filters into a Prisma query. */
export function studentWhere(
  query: StudentListQuery,
  group?: GroupAccessRef | null,
): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [];
  const add = (condition: Prisma.StudentWhereInput) => and.push(condition);

  if (query.isActive !== undefined) add({ isActive: query.isActive });
  if (query.isTestBlocked !== undefined) add({ isTestBlocked: query.isTestBlocked });
  if (query.preTestReady !== undefined) add({ preTestReady: query.preTestReady });
  if (query.profileCompleted !== undefined) add({ profileCompleted: query.profileCompleted });

  if (query.groupId) add(membersOf(query.groupId, group));
  // The branch a student attends is a column of its own — no join.
  if (query.branchId) add({ currentBranchId: query.branchId });
  if (query.ungrouped !== undefined) add(ownAccessFilter(query.ungrouped));
  if (query.neverSignedIn !== undefined) add(signedInFilter(query.neverSignedIn));

  if (query.hasDefaultPin !== undefined) add({ pinIsDefault: query.hasDefaultPin });

  const joined = dateRange(query.joinedFrom, query.joinedTo);
  if (joined) add(joined);

  const search = query.q?.trim();
  if (search) {
    add({
      OR: [
        { mobile: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  // An empty AND is a valid Prisma filter, but returning {} keeps "no filters"
  // obvious to anyone reading a log or a test.
  return and.length === 0 ? {} : { AND: and };
}

/** Access of the student's own: an enrolment, or a grant. The all-students group reaches them anyway. */
function ownAccessFilter(hasNoneOfTheirOwn: boolean): Prisma.StudentWhereInput {
  // BOTH empty: an EXAM group is reached by an enrolment, with no grant row.
  const noneOfTheirOwn = {
    enrolledExams: { isEmpty: true },
    directGroupIds: { isEmpty: true },
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

/** The same three cases `GroupsService.studentCountFor` counts, so the link and the count agree. */
function membersOf(
  groupId: string,
  group: GroupAccessRef | null | undefined,
): Prisma.StudentWhereInput {
  if (!group) return { directGroupIds: { has: groupId } };

  const reach = groupReach(group);
  if (reach === GROUP_REACH.EVERYONE) return { deletedAt: null };
  if (reach === GROUP_REACH.ENROLMENT && group.examType)
    return { enrolledExams: { has: group.examType } };
  return { directGroupIds: { has: group.id } };
}

/** An inclusive day range over a timestamp column. */
function dateRange(
  from: string | undefined,
  to: string | undefined,
): Prisma.StudentWhereInput | null {
  if (!from && !to) return null;

  return {
    createdAt: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    },
  };
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
