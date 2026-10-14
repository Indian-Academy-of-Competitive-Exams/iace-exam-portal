import { Prisma } from '@prisma/client';
import { ASSIGNMENT_ROLES, SECTION_SEATS, type LocalizedContent } from '@iace/contracts';
import { stemPreviewOf } from './question-core';
import { reviewOf, type Context, type ScopedQuestion } from './section-rules';

/** The paper in its order, then what was typed for it and not chosen; a reader sees the paper once it reaches them. */
export async function scopedQuestions(
  db: Prisma.TransactionClient,
  context: Context,
): Promise<ScopedQuestion[]> {
  const { pair } = context;
  const paper = await db.paperQuestion.findMany({
    where: pair,
    select: { questionId: true, order: true },
    orderBy: { order: 'asc' },
  });
  if (context.seat === SECTION_SEATS.READER && !context.mine?.handedAt) return [];

  const onPaper = paper.map((row) => row.questionId);
  const typed =
    context.seat === SECTION_SEATS.READER
      ? []
      : await db.question.findMany({
          where: {
            assignment: { ...pair, role: ASSIGNMENT_ROLES.TYPIST },
            id: { notIn: onPaper },
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
  const ids = [...onPaper, ...typed.map((row) => row.id)];
  if (ids.length === 0) return [];

  const [questions, reviews] = await Promise.all([
    db.question.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        difficulty: true,
        createdById: true,
        assignment: { select: { testId: true, baseConfigSectionId: true, role: true } },
        currentVersion: { select: { content: true } },
      },
    }),
    db.questionReview.findMany({
      where: { testId: pair.testId, questionId: { in: ids } },
    }),
  ]);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const reviewById = new Map(reviews.map((review) => [review.questionId, review]));
  const orderById = new Map(paper.map((row) => [row.questionId, row.order]));

  return ids.flatMap((id) => {
    const question = byId.get(id);
    if (!question) return [];
    const written = question.assignment;
    return [
      {
        id,
        order: orderById.get(id) ?? null,
        typed:
          written?.role === ASSIGNMENT_ROLES.TYPIST &&
          written.testId === pair.testId &&
          written.baseConfigSectionId === pair.baseConfigSectionId,
        createdById: question.createdById,
        difficulty: question.difficulty,
        preview: stemPreviewOf(
          (question.currentVersion?.content as LocalizedContent | undefined) ?? {},
        ),
        review: reviewOf(reviewById.get(id)),
      },
    ];
  });
}
