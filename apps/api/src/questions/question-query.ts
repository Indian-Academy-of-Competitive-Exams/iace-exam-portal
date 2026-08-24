import { Prisma } from '@prisma/client';
import {
  QUESTION_SORTS,
  QUESTION_STATUS,
  type QuestionListQuery,
  type QuestionSort,
} from '@iace/contracts';
import { matchFilters } from '../common/match-filters';

/** The filter half of the questions list. Pure, so it is testable without a database. */
export function questionWhere(
  query: QuestionListQuery,
  matchedIds: string[] | null,
): Prisma.QuestionWhereInput {
  /** What the match toggle governs. */
  const chosen: Prisma.QuestionWhereInput[] = [];
  /** What narrows the bank whichever mode is chosen. */
  const always: Prisma.QuestionWhereInput[] = [];

  // A set, or undefined — never [], which Prisma reads as "match nothing" rather than "any".
  if (query.subjectId) chosen.push({ subjectId: { in: query.subjectId } });
  if (query.topicId) chosen.push({ topicId: { in: query.topicId } });
  if (query.type) chosen.push({ type: { in: query.type } });
  if (query.difficulty) chosen.push({ difficulty: { in: query.difficulty } });
  // Out of circulation is out of the bank: naming a status is how you ask to see them.
  if (query.status) chosen.push({ status: { in: query.status } });
  else always.push({ status: { not: QUESTION_STATUS.ARCHIVED } });
  if (query.tag) chosen.push({ tags: { has: query.tag } });

  // A language is present when the CURRENT version has a stem in it, which is the key
  // `buildContent` writes. The content is on the version, so the filter travels through it.
  if (query.language) {
    chosen.push({ currentVersion: { content: { path: [query.language], not: Prisma.DbNull } } });
  }

  // The search already ran as its own query; an empty result must match nothing
  // rather than being dropped, or a search for nonsense would list everything.
  if (matchedIds) always.push({ id: { in: matchedIds } });

  const and = matchFilters(always, chosen, query.match);

  return and.length > 0 ? { AND: and } : {};
}

export function questionOrderBy(sort: QuestionSort): Prisma.QuestionOrderByWithRelationInput[] {
  // `id` last, always: two questions saved in the same millisecond would
  // otherwise page in an order the database is free to change between requests.
  if (sort === QUESTION_SORTS.OLDEST) return [{ createdAt: 'asc' }, { id: 'asc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}
