import type { Prisma } from '@prisma/client';
import { ASSIGNMENT_ROLES, AUDIT_FEATURE } from '@iace/contracts';
import { countsBy } from '../common/relation-counts';
import { handKey, sectionKey, sectionPairs, type SectionPair } from './assignment-counts';

/** What `removable` is decided on, whichever read the row came off. */
export interface RemovableRow extends SectionPair {
  id: string;
  assigneeId: string;
  finalizedAt: Date | null;
  replacedAt: Date | null;
  createdAt: Date;
}

/** Typed, edited, reviewed, commented or finished anything on the section: then it is a record. Six reads for a whole page, not six per row. */
export async function removableIds(
  db: Prisma.TransactionClient,
  rows: readonly RemovableRow[],
): Promise<Set<string>> {
  const open = rows.filter((row) => !row.finalizedAt && !row.replacedAt);
  if (open.length === 0) return new Set();

  const onSection = await questionsOn(db, sectionPairs(open));
  const worked = await handsThatWorked(db, open, onSection);
  return new Set(open.filter((row) => !worked.has(row.id)).map((row) => row.id));
}

/** Every question a section holds, placed on its paper or typed under its typist. */
async function questionsOn(
  db: Prisma.TransactionClient,
  pairs: readonly SectionPair[],
): Promise<ReadonlyMap<string, string[]>> {
  // Two indexed reads: one OR across both relations planned as a scan of the whole bank.
  const [placed, typedHere] = await Promise.all([
    db.paperQuestion.findMany({
      where: { OR: [...pairs] },
      select: { testId: true, baseConfigSectionId: true, questionId: true },
    }),
    db.question.findMany({
      where: { assignment: { OR: [...pairs], role: ASSIGNMENT_ROLES.TYPIST } },
      select: { id: true, assignment: { select: { testId: true, baseConfigSectionId: true } } },
    }),
  ]);
  const onSection = new Map<string, string[]>();
  for (const row of placed) alsoOn(onSection, sectionKey(row), row.questionId);
  for (const row of typedHere) {
    if (row.assignment) alsoOn(onSection, sectionKey(row.assignment), row.id);
  }
  return onSection;
}

/** Which of the rows have work under them: typed, reviewed, commented on, or edited since. */
async function handsThatWorked(
  db: Prisma.TransactionClient,
  open: readonly RemovableRow[],
  onSection: ReadonlyMap<string, string[]>,
): Promise<ReadonlySet<string>> {
  const pairs = [...sectionPairs(open)];
  const who = [...new Set(open.map((row) => row.assigneeId))];
  const since = new Date(Math.min(...open.map((row) => row.createdAt.getTime())));
  const onAnySection = [...new Set([...onSection.values()].flat())];

  const [typed, reviewed, said, edited] = await Promise.all([
    db.question.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: open.map((row) => row.id) } },
      _count: true,
    }),
    db.questionReview.findMany({
      where: { AND: [{ OR: pairs }, { OR: reviewedByAnyOf(who) }] },
      select: REVIEW_HAND_SELECT,
    }),
    db.sectionComment.groupBy({
      by: ['testId', 'baseConfigSectionId', 'authorId'],
      where: { AND: [{ OR: pairs }, { authorId: { in: who } }] },
      _count: true,
    }),
    // The latest edit per question and admin: a row is a record once one lands after it began.
    db.rowActionLog.groupBy({
      by: ['actorId', 'entityId'],
      where: {
        actorId: { in: who },
        feature: AUDIT_FEATURE.QUESTION,
        createdAt: { gte: since },
        entityId: { in: onAnySection },
      },
      _max: { createdAt: true },
    }),
  ]);

  const wrote = countsBy(typed, 'assignmentId');
  const touched = new Set([
    ...reviewed.flatMap(handsOnReview),
    ...said.map((row) => handKey(sectionKey(row), row.authorId)),
  ]);
  const editedAt = new Map(
    edited.flatMap((row) =>
      row.actorId === null ? [] : [[handKey(row.entityId, row.actorId), row._max.createdAt]],
    ),
  );
  const editedSince = (row: RemovableRow): boolean =>
    (onSection.get(sectionKey(row)) ?? []).some((questionId) => {
      const at = editedAt.get(handKey(questionId, row.assigneeId));
      return at !== null && at !== undefined && at >= row.createdAt;
    });

  return new Set(
    open
      .filter(
        (row) =>
          (wrote.get(row.id) ?? 0) > 0 ||
          touched.has(handKey(sectionKey(row), row.assigneeId)) ||
          editedSince(row),
      )
      .map((row) => row.id),
  );
}

function alsoOn(held: Map<string, string[]>, key: string, questionId: string): void {
  const so_far = held.get(key) ?? [];
  so_far.push(questionId);
  held.set(key, so_far);
}

const REVIEW_HAND_SELECT = {
  testId: true,
  baseConfigSectionId: true,
  checkedById: true,
  sentBackById: true,
  fixedById: true,
} as const satisfies Prisma.QuestionReviewSelect;

const reviewedByAnyOf = (who: readonly string[]): Prisma.QuestionReviewWhereInput[] => [
  { checkedById: { in: [...who] } },
  { sentBackById: { in: [...who] } },
  { fixedById: { in: [...who] } },
];

/** Whoever's hand is on this review, as the section keys the batch compares against. */
const handsOnReview = (
  row: Prisma.QuestionReviewGetPayload<{ select: typeof REVIEW_HAND_SELECT }>,
): string[] =>
  [row.checkedById, row.sentBackById, row.fixedById].flatMap((adminId) =>
    adminId === null ? [] : [handKey(sectionKey(row), adminId)],
  );
