import { Prisma } from '@prisma/client';
import { ASSIGNMENT_ROLES, type QuestionOnOtherTest } from '@iace/contracts';
import { reachableTest } from './question-query';

/** Which other tests hold this question, asked before the edit rather than reported after it. */
export async function otherTestsOf(
  db: Prisma.TransactionClient,
  testId: string,
  questionId: string,
): Promise<QuestionOnOtherTest[]> {
  const rows = await db.paperQuestion.findMany({
    where: { questionId, testId: { not: testId } },
    select: {
      baseConfigSection: { select: { name: true } },
      test: {
        select: {
          id: true,
          title: true,
          opensAt: true,
          assignments: {
            where: { replacedAt: null, role: ASSIGNMENT_ROLES.PROOFREADER },
            select: { finalizedAt: true },
          },
        },
      },
    },
    orderBy: { test: { opensAt: 'asc' } },
  });
  if (rows.length === 0) return [];

  // The same predicate the version rule turns on, so the warning and the rewrite cannot disagree.
  const open = await db.test.findMany({
    where: { id: { in: rows.map((row) => row.test.id) }, ...reachableTest(new Date()) },
    select: { id: true },
  });
  const opened = new Set(open.map((row) => row.id));

  return rows.map((row) => ({
    testId: row.test.id,
    testTitle: row.test.title,
    sectionName: row.baseConfigSection.name,
    underReview: row.test.assignments.some((each) => each.finalizedAt === null),
    isOpen: opened.has(row.test.id),
    opensAt: row.test.opensAt?.toISOString() ?? null,
  }));
}
