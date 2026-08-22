import { Prisma } from '@prisma/client';
import { QUESTION_SORTS, type QuestionListQuery, type QuestionSort } from '@iace/contracts';

/** The filter half of the questions list. Pure, so it is testable without a database. */
export function questionWhere(
  query: QuestionListQuery,
  matchedIds: string[] | null,
): Prisma.QuestionWhereInput {
  const and: Prisma.QuestionWhereInput[] = [];

  // A set, or undefined — never [], which Prisma reads as "match nothing" rather than "any".
  if (query.subjectId) and.push({ subjectId: { in: query.subjectId } });
  if (query.topicId) and.push({ topicId: { in: query.topicId } });
  if (query.type) and.push({ type: { in: query.type } });
  if (query.difficulty) and.push({ difficulty: { in: query.difficulty } });
  if (query.status) and.push({ status: { in: query.status } });
  if (query.tag) and.push({ tags: { has: query.tag } });

  // A language is present when the CURRENT version has a stem in it, which is the key
  // `buildContent` writes. The content is on the version, so the filter travels through it.
  if (query.language) {
    and.push({ currentVersion: { content: { path: [query.language], not: Prisma.DbNull } } });
  }

  // The search already ran as its own query; an empty result must match nothing
  // rather than being dropped, or a search for nonsense would list everything.
  if (matchedIds) and.push({ id: { in: matchedIds } });

  return and.length > 0 ? { AND: and } : {};
}

export function questionOrderBy(sort: QuestionSort): Prisma.QuestionOrderByWithRelationInput[] {
  // `id` last, always: two questions saved in the same millisecond would
  // otherwise page in an order the database is free to change between requests.
  if (sort === QUESTION_SORTS.OLDEST) return [{ createdAt: 'asc' }, { id: 'asc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}
