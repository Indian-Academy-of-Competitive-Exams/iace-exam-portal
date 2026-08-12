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
 * Every filter is ABSENT-OR-APPLIED — never "false means don't care". A
 * three-state control (any / yes / no) has to be able to ask for `false`.
 */
export function studentWhere(query: StudentListQuery): Prisma.StudentWhereInput {
  const search = query.q?.trim();

  return {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.preTestReady === undefined ? {} : { preTestReady: query.preTestReady }),
    ...(query.profileCompleted === undefined ? {} : { profileCompleted: query.profileCompleted }),

    // A student's route to a test runs through their groups, so both of these
    // ask about membership rather than a column on the student.
    ...(query.groupId ? { groups: { some: { id: query.groupId } } } : {}),
    ...(query.branchId ? { groups: { some: { branchId: query.branchId } } } : {}),
    ...(query.ungrouped === undefined
      ? {}
      : { groups: query.ungrouped ? { none: {} } : { some: {} } }),

    // Matches `hasSignedIn` exactly — a PIN the institute set does not count,
    // or the filter and the badge beside it would disagree.
    ...(query.neverSignedIn === undefined
      ? {}
      : query.neverSignedIn
        ? { OR: [{ pinHash: null }, { pinIsDefault: true }] }
        : { pinHash: { not: null }, pinIsDefault: false }),

    ...(query.hasDefaultPin === undefined ? {} : { pinIsDefault: query.hasDefaultPin }),

    ...dateRange(query.joinedFrom, query.joinedTo),

    ...(search
      ? {
          OR: [
            { mobile: { contains: search } },
            { fullName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

/**
 * An inclusive day range over a timestamp column.
 *
 * `joinedTo` is the END of that day, not its midnight. A range of 3rd–3rd that
 * matched nothing because everyone enrolled after 00:00 is the kind of empty
 * table an admin reads as "there are none".
 */
function dateRange(from: string | undefined, to: string | undefined): Prisma.StudentWhereInput {
  if (!from && !to) return {};

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
