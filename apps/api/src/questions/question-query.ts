import { Prisma } from '@prisma/client';
import {
  QUESTION_SORTS,
  QUESTION_STATUS,
  WRITTEN_FOR,
  type QuestionListQuery,
  type QuestionSort,
} from '@iace/contracts';
import { matchFilters } from '../common/match-filters';
import { drawableFor } from './question-core';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';

/** Spec §3: reachable is `min(Test.opensAt, min(TestProgramUnlock.opensAt)) <= now`, a program opening earlier than its test included. */
export const reachableTest = (now: Date): Prisma.TestWhereInput => ({
  // The offer watermark itself, not `status <> DRAFT`: a never-offered draft can be set INACTIVE.
  finalizedAt: { not: null },
  OR: [
    { opensAt: null },
    { opensAt: { lte: now } },
    { programUnlocks: { some: { opensAt: { lte: now } } } },
  ],
});

/** A civil day in Asia/Kolkata is a whole day, not the instant its name would parse to. */
export function writtenBetween(from: string | undefined, to: string | undefined) {
  return {
    ...(from ? { gte: startOfInstituteDay(from) } : {}),
    ...(to ? { lte: endOfInstituteDay(to) } : {}),
  };
}

/** The filter half of the questions list. Pure, so it is testable without a database. */
export function questionWhere(
  query: QuestionListQuery,
  matchedIds: string[] | null,
): Prisma.QuestionWhereInput {
  const and = matchFilters(narrowsTheBank(query, matchedIds), whatWasAsked(query), query.match);

  return and.length > 0 ? { AND: and } : {};
}

/** What narrows the bank whichever mode is chosen — the match toggle does not reach these. */
function narrowsTheBank(
  query: QuestionListQuery,
  matchedIds: string[] | null,
): Prisma.QuestionWhereInput[] {
  const filters: Prisma.QuestionWhereInput[] = [];

  // Out of circulation is out of the bank: naming a status is how you ask to see them.
  if (!query.status) filters.push({ status: { not: QUESTION_STATUS.ARCHIVED } });
  // The picker asks the same question the draw asks, so it cannot offer a row fillSection refuses.
  if (query.drawable) filters.push(drawableFor(query.forTestId));
  // Resolved through the assignment relation, so no caller has to carry a list of ids in the URL.
  if (query.forTestId && query.writtenFor) {
    const wroteIt = { assignment: { testId: query.forTestId } };
    filters.push(query.writtenFor === WRITTEN_FOR.BANK ? { NOT: wroteIt } : wroteIt);
  }
  // The search ran as its own query, so an empty result must match nothing rather than be dropped.
  if (matchedIds) filters.push({ id: { in: matchedIds } });

  return filters;
}

/** What the match toggle governs: the filters the reader chose, each one narrowing or widening. */
function whatWasAsked(query: QuestionListQuery): Prisma.QuestionWhereInput[] {
  const filters: Prisma.QuestionWhereInput[] = [];

  // A set, or undefined — never [], which Prisma reads as "match nothing" rather than "any".
  if (query.subjectId) filters.push({ subjectId: { in: query.subjectId } });
  if (query.topicId) filters.push({ topicId: { in: query.topicId } });
  if (query.type) filters.push({ type: { in: query.type } });
  if (query.difficulty) filters.push({ difficulty: { in: query.difficulty } });
  if (query.status) filters.push({ status: { in: query.status } });
  if (query.tag) filters.push({ tags: { has: query.tag } });
  // No picker to choose an author from, so the name typed is matched against what they sign in as.
  if (query.author) {
    filters.push({
      createdBy: {
        OR: [
          { fullName: { contains: query.author, mode: 'insensitive' } },
          { email: { contains: query.author, mode: 'insensitive' } },
        ],
      },
    });
  }
  if (query.from || query.to) filters.push({ createdAt: writtenBetween(query.from, query.to) });
  // A language is present when the CURRENT version has a stem in it, the key `buildContent` writes.
  if (query.language) {
    filters.push({ currentVersion: { content: { path: [query.language], not: Prisma.DbNull } } });
  }

  return filters;
}

export function questionOrderBy(sort: QuestionSort): Prisma.QuestionOrderByWithRelationInput[] {
  // `id` last, always: two questions saved in the same millisecond would otherwise page in an order the database is free to change between requests.
  if (sort === QUESTION_SORTS.OLDEST) return [{ createdAt: 'asc' }, { id: 'asc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}
