import { Prisma } from '@prisma/client';
import { STUDENT_SORTS, type StudentListQuery, type StudentSort } from '@iace/contracts';

/**
 * Turns the roster's filters into a Prisma query.
 *
 * Pure, and separate from the service, because this is where a filter quietly
 * goes wrong: an absent filter that narrows anyway, or a pair of filters that
 * stop combining, both look like a working screen showing the wrong people.
 * Testing it needs no database.
 *
 * Every condition is pushed onto an AND list rather than merged into one
 * object. That is not a style choice — it is the fix for a real bug. Three of
 * these filters describe `groups` and two describe `OR`, and in an object
 * literal the last spread silently wins: filtering "never signed in" and then
 * typing a name dropped the status filter entirely, and the roster showed
 * everyone while looking exactly right. A list cannot overwrite itself.
 *
 * Every filter is ABSENT-OR-APPLIED — never "false means don't care". A
 * three-state control (any / yes / no) has to be able to ask for `false`.
 */
export function studentWhere(query: StudentListQuery): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [];
  const add = (condition: Prisma.StudentWhereInput) => and.push(condition);

  if (query.isActive !== undefined) add({ isActive: query.isActive });
  if (query.preTestReady !== undefined) add({ preTestReady: query.preTestReady });
  if (query.profileCompleted !== undefined) add({ profileCompleted: query.profileCompleted });

  // A student's route to a test runs through their groups, so all three of
  // these ask about membership rather than a column on the student.
  if (query.groupId) add({ groups: { some: { id: query.groupId } } });
  if (query.branchId) add({ groups: { some: { branchId: query.branchId } } });
  if (query.ungrouped !== undefined) {
    add({ groups: query.ungrouped ? { none: {} } : { some: {} } });
  }

  // Matches `hasSignedIn` exactly — a PIN the institute set does not count, or
  // the filter and the badge beside it would disagree.
  if (query.neverSignedIn !== undefined) {
    add(
      query.neverSignedIn
        ? { OR: [{ pinHash: null }, { pinIsDefault: true }] }
        : { pinHash: { not: null }, pinIsDefault: false },
    );
  }

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

/**
 * An inclusive day range over a timestamp column.
 *
 * `joinedTo` is the END of that day, not its midnight. A range of 3rd–3rd that
 * matched nothing because everyone enrolled after 00:00 is the kind of empty
 * table an admin reads as "there are none".
 */
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

/**
 * Ordering, always tie-broken by id.
 *
 * Without the tie-break, rows sharing a sort value can come back in a different
 * order on each query — which pages a student twice and hides another entirely.
 */
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
