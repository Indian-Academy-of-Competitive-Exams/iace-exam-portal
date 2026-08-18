import { Prisma } from '@prisma/client';
import { QUESTION_SORTS, type QuestionListQuery, type QuestionSort } from '@iace/contracts';

/** The filter half of the questions list. Pure, so it is testable without a database. */
export function questionWhere(
  query: QuestionListQuery,
  matchedIds: string[] | null,
): Prisma.QuestionWhereInput {
  const and: Prisma.QuestionWhereInput[] = [];

  if (query.subjectId) and.push({ subjectId: query.subjectId });
  if (query.topicId) and.push({ topicId: query.topicId });
  if (query.subTopicId) and.push({ subTopicId: query.subTopicId });
  if (query.type) and.push({ type: query.type });
  if (query.difficulty) and.push({ difficulty: query.difficulty });
  if (query.status) and.push({ status: query.status });
  if (query.isActive !== undefined) and.push({ isActive: query.isActive });
  if (query.tag) and.push({ tags: { has: query.tag } });

  // A language is present when it has a stem, which is the key `buildContent` writes.
  if (query.language) and.push({ content: { path: [query.language], not: Prisma.DbNull } });

  // The search already ran as its own query; an empty result must match nothing
  // rather than being dropped, or a search for nonsense would list everything.
  if (matchedIds) and.push({ id: { in: matchedIds } });

  return and.length > 0 ? { AND: and } : {};
}

export function questionOrderBy(sort: QuestionSort): Prisma.QuestionOrderByWithRelationInput[] {
  // `id` last, always: two questions saved in the same millisecond would
  // otherwise page in an order the database is free to change between requests.
  switch (sort) {
    case QUESTION_SORTS.OLDEST:
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
