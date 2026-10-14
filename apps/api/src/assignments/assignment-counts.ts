import type { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  type AssignmentRole,
  type PaperSource,
} from '@iace/contracts';
import { uncheckedOn } from './unread-questions';

/** A section is only unique within its own test — two tests can share a base config's section id. */
export const sectionKey = (row: { testId: string; baseConfigSectionId: string }): string =>
  `${row.testId}:${row.baseConfigSectionId}`;

/** One admin's hands on one thing, so a section's and a question's work read out of one set. */
export const handKey = (what: string, adminId: string): string => `${what}|${adminId}`;

export interface SectionPair {
  testId: string;
  baseConfigSectionId: string;
}

/** One admin in one role on one section — what their time on it is kept under. */
export interface SeatRow extends SectionPair {
  assigneeId: string;
  role: AssignmentRole;
}

export const seatKey = (row: SeatRow): string =>
  `${handKey(sectionKey(row), row.assigneeId)}|${row.role}`;

export const sectionPairs = (rows: readonly SectionPair[]): SectionPair[] =>
  [...new Map(rows.map((row) => [sectionKey(row), row])).values()].map(
    ({ testId, baseConfigSectionId }) => ({ testId, baseConfigSectionId }),
  );

/** A `groupBy` over (test, section) as a lookup on the key the rest of this file uses. */
const sectionCountsIn = (
  groups: readonly (SectionPair & { _count: { _all: number } })[],
): Map<string, number> => new Map(groups.map((group) => [sectionKey(group), group._count._all]));

/** What a release turns on: typing still open on the section, its rows on the paper, and the unchecked ones among them. */
export interface ReleaseCounts {
  typing: number;
  onPaper: number;
  unchecked: number;
}

export const NO_RELEASE_COUNTS: ReleaseCounts = { typing: 0, onPaper: 0, unchecked: 0 };

export function releaseGapOf(counts: ReleaseCounts, needed: number): string | null {
  if (counts.typing > 0) return 'Its typist has not marked this section done yet.';
  if (counts.onPaper < needed) {
    return `The paper holds ${counts.onPaper} of the ${needed} questions this section needs.`;
  }
  if (counts.unchecked > 0) {
    return `${counts.unchecked} of this section's questions are not checked yet.`;
  }
  return null;
}

/** A page row's own gap: a section the counts never saw holds nothing, which is a gap of its whole count. */
export const gapFrom = (
  counts: ReleaseCounts | undefined,
  row: { baseConfigSection: { questionCount: number } },
): string | null => releaseGapOf(counts ?? NO_RELEASE_COUNTS, row.baseConfigSection.questionCount);

/** What a section holds, counted across every assignment on it. */
export interface SectionCounts {
  writtenCount: number;
}

export const NO_COUNTS: SectionCounts = { writtenCount: 0 };

/** A section's counts, and the time of the one row's holder beside them. */
export interface RowFacts extends SectionCounts {
  secondsSpent: number;
}

/** The three counts a release turns on, for every section named at once — a page of the queue asked one section at a time was three statements a row. */
export async function releaseCounts(
  db: Prisma.TransactionClient,
  rows: readonly (SectionPair & { test: { paperSource: PaperSource | null } })[],
): Promise<Map<string, ReleaseCounts>> {
  const sections = sectionPairs(rows);
  if (sections.length === 0) return new Map();

  // A picked section's typist only fixes what comes back, so it never finishes the section.
  const typed = sectionPairs(rows.filter((row) => row.test.paperSource === PAPER_SOURCES.FRAMED));
  const [typing, onPaper, unchecked] = await Promise.all([
    typed.length === 0
      ? []
      : db.questionAssignment.groupBy({
          by: ['testId', 'baseConfigSectionId'],
          where: {
            OR: typed,
            role: ASSIGNMENT_ROLES.TYPIST,
            finalizedAt: null,
            replacedAt: null,
          },
          _count: { _all: true },
        }),
    db.paperQuestion.groupBy({
      by: ['testId', 'baseConfigSectionId'],
      where: { OR: sections },
      _count: { _all: true },
    }),
    db.paperQuestion.groupBy({
      by: ['testId', 'baseConfigSectionId'],
      where: {
        OR: sections.map(({ testId, baseConfigSectionId }) => ({
          ...uncheckedOn(testId),
          baseConfigSectionId,
        })),
      },
      _count: { _all: true },
    }),
  ]);

  const [typingBy, onPaperBy, uncheckedBy] = [typing, onPaper, unchecked].map(sectionCountsIn);
  return new Map(
    sections.map((row) => {
      const key = sectionKey(row);
      return [
        key,
        {
          typing: typingBy?.get(key) ?? 0,
          onPaper: onPaperBy?.get(key) ?? 0,
          unchecked: uncheckedBy?.get(key) ?? 0,
        },
      ];
    }),
  );
}

/** Every assignment on a row's own (test, section), not just the row's — the typist's work counts for the reader. */
export async function sectionWrittenCounts(
  db: Prisma.TransactionClient,
  rows: readonly SectionPair[],
): Promise<Map<string, SectionCounts>> {
  const sections = [...new Map(rows.map((row) => [sectionKey(row), row])).values()];
  if (sections.length === 0) return new Map();

  const held = await db.questionAssignment.findMany({
    where: {
      OR: sections.map(({ testId, baseConfigSectionId }) => ({ testId, baseConfigSectionId })),
    },
    select: { id: true, testId: true, baseConfigSectionId: true },
  });
  const ids = held.map((row) => row.id);
  const written =
    ids.length === 0
      ? []
      : await db.question.groupBy({
          by: ['assignmentId'],
          where: { assignmentId: { in: ids } },
          _count: { _all: true },
        });
  const writtenBy = new Map(written.map((row) => [row.assignmentId, row._count._all]));

  const bySection = new Map(sections.map((row) => [sectionKey(row), NO_COUNTS]));
  for (const row of held) {
    const key = sectionKey(row);
    const so_far = bySection.get(key);
    if (!so_far) continue;
    bySection.set(key, { writtenCount: so_far.writtenCount + (writtenBy.get(row.id) ?? 0) });
  }
  return bySection;
}

/** Seconds each holder has had their section's questions on screen, in the seat they hold it from. */
export async function spentSeconds(
  db: Prisma.TransactionClient,
  rows: readonly SeatRow[],
): Promise<Map<string, number>> {
  if (rows.length === 0) return new Map();

  const groups = await db.questionWorkTime.groupBy({
    by: ['testId', 'baseConfigSectionId', 'adminId', 'role'],
    // Whole tests, not each section: one index range a test, and a seat nobody asked about is never looked up.
    where: {
      testId: { in: [...new Set(rows.map((row) => row.testId))] },
      adminId: { in: [...new Set(rows.map((row) => row.assigneeId))] },
    },
    _sum: { seconds: true },
  });
  return new Map(
    groups.map((group) => [
      seatKey({ ...group, assigneeId: group.adminId }),
      group._sum.seconds ?? 0,
    ]),
  );
}

/** What a row reads off its section and its holder, for every row asked about at once. */
export async function factsOf(
  db: Prisma.TransactionClient,
  rows: readonly SeatRow[],
): Promise<(row: SeatRow) => RowFacts> {
  const [written, spent] = await Promise.all([
    sectionWrittenCounts(db, rows),
    spentSeconds(db, rows),
  ]);
  return (row) => ({
    ...(written.get(sectionKey(row)) ?? NO_COUNTS),
    secondsSpent: spent.get(seatKey(row)) ?? 0,
  });
}
