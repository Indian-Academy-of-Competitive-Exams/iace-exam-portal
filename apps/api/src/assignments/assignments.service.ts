import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ROLES,
  ASSIGNMENT_ROLES,
  AUDIT_FEATURE,
  AppException,
  ErrorCodes,
  FEATURES,
  FEATURE_KEYS,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  satisfiesLevel,
  scopedSections,
  type AdminRole,
  type Assignment,
  type AssignableAdmin,
  type AssignmentRole,
  type AssignmentSection,
  type AssignmentSectionsQuery,
  type AssignmentTest,
  type AssignmentTestsQuery,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type DifficultyMix,
  type DrawSpec,
  type FeatureKey,
  type MineAssignmentsQuery,
  type Paginated,
  type PaperSource,
  type SectionProgressQuery,
  type SectionProgressRow,
  type SectionRoleProgress,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins';
import { isUniqueViolation } from '../common/prisma-errors';
import { scopeRefOf } from '../common/prisma-json';
import { assertSourceChosen, beginDraftPaperEdit } from '../common/paper-edit';
import { pageArgs, paged } from '../common/pagination';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import { uncheckedOn } from './unread-questions';
import { doneOpen, readOpen } from './assignment-gates';
import { formRefusal } from '../common/form-refusal';
import { everyTermMatches } from '../common/search-terms';
import { countsBy } from '../common/relation-counts';

const CHOOSE_WITH_DONE_MESSAGE =
  'Mark the section done by choosing its questions, so the reader gets the paper they will read.';
const OFFERED_MESSAGE = 'This test has been offered, so nobody new can be given its sections.';
const PASSED_ON_MESSAGE =
  'This section has passed to somebody else, so it is no longer yours to release.';
const LEFT_TEST_MESSAGE = 'This section left the test, so there is nothing of it to release.';
const NOT_HANDED_MESSAGE = 'This section has not reached you yet.';
const READING_OVER_MESSAGE = 'This test has been offered, so its reading is over.';
const ALREADY_HOLDS_MESSAGE = 'This admin already holds that role on this section.';
const HAS_WORKED_MESSAGE =
  'Work has been done under this assignment, so it stays on the record. Give the role to somebody else instead.';
const REPLACED_MESSAGE = 'This assignment has passed to somebody else and stays on the record.';
const SECTION_DROPPED_MESSAGE =
  'This section left the test, and the assignment stays on the record.';

const notWhole = (issue: string) => formRefusal(ErrorCodes.CONFLICT, issue);

const ASSIGNMENT_INCLUDE = {
  baseConfigSection: {
    select: { id: true, moduleId: true, name: true, questionCount: true, subjectId: true },
  },
  assignee: { select: { fullName: true, email: true } },
  test: {
    select: {
      questionPoolFilter: true,
      finalizedAt: true,
      paperSource: true,
      scope: true,
      scopeRef: true,
    },
  },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentRow = Prisma.QuestionAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

const WITH_TEST_INCLUDE = {
  ...ASSIGNMENT_INCLUDE,
  test: { select: { ...ASSIGNMENT_INCLUDE.test.select, title: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentWithTestRow = Prisma.QuestionAssignmentGetPayload<{
  include: typeof WITH_TEST_INCLUDE;
}>;

/** The key a role's work needs — assigning it to someone without it would fail every write they made. */
const FEATURE_FOR_ROLE: Record<AssignmentRole, FeatureKey> = {
  [ASSIGNMENT_ROLES.TYPIST]: FEATURE_KEYS.QUESTION_AUTHORING,
  [ASSIGNMENT_ROLES.PROOFREADER]: FEATURE_KEYS.QUESTION_PROOFREAD,
};

/** What somebody doing this job is CALLED — it orders the picker and decides nothing. */
const ADMIN_ROLE_FOR_ROLE: Record<AssignmentRole, AdminRole> = {
  [ASSIGNMENT_ROLES.TYPIST]: ADMIN_ROLES.TYPIST,
  [ASSIGNMENT_ROLES.PROOFREADER]: ADMIN_ROLES.PROOFREADER,
};

/** Both sources take both roles: on a picked paper the typist fixes what its reader sends back. */
const SOURCES_FOR_ROLE: Record<AssignmentRole, readonly PaperSource[]> = {
  [ASSIGNMENT_ROLES.TYPIST]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
  [ASSIGNMENT_ROLES.PROOFREADER]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
};

const TEST_QUEUE_SELECT = {
  id: true,
  title: true,
  paperSource: true,
  scope: true,
  scopeRef: true,
  questionPoolFilter: true,
  baseConfig: {
    select: {
      sections: {
        select: { id: true, name: true, order: true, moduleId: true, questionCount: true },
        orderBy: { order: 'asc' },
      },
    },
  },
  assignments: {
    where: { replacedAt: null },
    select: {
      id: true,
      role: true,
      baseConfigSectionId: true,
      assigneeId: true,
      dueAt: true,
      finalizedAt: true,
      assignee: { select: { fullName: true, email: true } },
    },
  },
} as const satisfies Prisma.TestSelect;

type QueueTest = Prisma.TestGetPayload<{ select: typeof TEST_QUEUE_SELECT }>;
type QueueSection = QueueTest['baseConfig']['sections'][number];

interface DueBounds {
  from?: Date;
  to?: Date;
}

/** Institute days, inclusive at both ends — a UTC midnight would drop everything due that evening. */
function dueBounds(query: { dueFrom?: string; dueTo?: string }): DueBounds | undefined {
  if (!query.dueFrom && !query.dueTo) return undefined;
  return {
    ...(query.dueFrom ? { from: startOfInstituteDay(query.dueFrom) } : {}),
    ...(query.dueTo ? { to: endOfInstituteDay(query.dueTo) } : {}),
  };
}

/** A role nobody holds has no due date, so a due-date filter cannot be looking for it. */
const withinDue = (at: Date | null, bounds: DueBounds): boolean =>
  at !== null && (!bounds.from || at >= bounds.from) && (!bounds.to || at <= bounds.to);

/** A test still being built: the picker and the progress list must offer and list the same ones. */
const UNFROZEN_TEST = {
  finalizedAt: null,
  paperSource: { not: null },
} as const satisfies Prisma.TestWhereInput;

const sectionsOf = (test: QueueTest): QueueSection[] => [
  ...scopedSections(test.baseConfig.sections, test.scope, scopeRefOf(test)),
];

/** Null where the paper's source gives the role nothing to do; otherwise who holds it, if anybody. */
function roleProgress(
  test: QueueTest,
  section: QueueSection,
  role: AssignmentRole,
): SectionRoleProgress | null {
  const source = test.paperSource;
  if (source === null || !SOURCES_FOR_ROLE[role].includes(source)) return null;

  const held =
    test.assignments.find((row) => row.role === role && row.baseConfigSectionId === section.id) ??
    null;

  return {
    assignmentId: held?.id ?? null,
    assigneeId: held?.assigneeId ?? null,
    assigneeName: held ? (held.assignee.fullName ?? held.assignee.email) : null,
    dueAt: held?.dueAt?.toISOString() ?? null,
    finalizedAt: held?.finalizedAt?.toISOString() ?? null,
  };
}

const roles = (row: SectionProgressRow): SectionRoleProgress[] =>
  [row.typing, row.reading].filter((held): held is SectionRoleProgress => held !== null);

/** Either half satisfies it: a section is theirs if they type it or read it. */
const heldByAnyOf = (row: SectionProgressRow, wanted: readonly string[]): boolean =>
  roles(row).some((held) => held.assigneeId !== null && wanted.includes(held.assigneeId));

/** Either half satisfies it: the two roles carry their own dates and need not agree. */
const dueWithin = (row: SectionProgressRow, bounds: DueBounds): boolean =>
  roles(row).some((held) => withinDue(held.dueAt === null ? null : new Date(held.dueAt), bounds));

const otherRole = (role: AssignmentRole): AssignmentRole =>
  role === ASSIGNMENT_ROLES.TYPIST ? ASSIGNMENT_ROLES.PROOFREADER : ASSIGNMENT_ROLES.TYPIST;

const roleLabel = (role: AssignmentRole): string =>
  role === ASSIGNMENT_ROLES.TYPIST ? 'typist' : 'proof-reader';

/** One person's job on one section of one test — a work queue per admin, and the gate `offer()` checks. */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admins: AdminsService,
  ) {}

  /** Every assignment on the test, section and assignee named, one query. */
  async forTest(testId: string): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ baseConfigSection: { order: 'asc' } }, { role: 'asc' }],
    });
    const [written, removable] = await Promise.all([
      this.sectionWrittenCounts(rows),
      this.removableIds(rows),
    ]);
    return rows.map((row) =>
      toAssignment(row, written.get(sectionKey(row)) ?? NO_COUNTS, removable.has(row.id)),
    );
  }

  /** Every row on one section, the replaced ones included, oldest first — the section's own record. */
  async sectionAssignments(testId: string, baseConfigSectionId: string): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId, baseConfigSectionId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const written = await this.sectionWrittenCounts(rows);
    return rows.map((row) => toAssignment(row, written.get(sectionKey(row)) ?? NO_COUNTS));
  }

  /** Active admins already holding what a role needs — who the picker offers, and nothing more. */
  async assignable(role: AssignmentRole): Promise<AssignableAdmin[]> {
    const called = ADMIN_ROLE_FOR_ROLE[role];
    const holders = await this.admins.holdersOf(FEATURE_FOR_ROLE[role], PERMISSION_LEVELS.WRITE);
    // The feature key decides who is on this list; the role only decides who is at the top of it.
    return holders.sort((a, b) => Number(b.role === called) - Number(a.role === called));
  }

  /** A role already held passes to the new admin: the earlier row stays, marked replaced, as the record. */
  async assign(testId: string, body: CreateAssignmentBody, actorId: string): Promise<Assignment> {
    const test = await this.requireTest(testId);
    if (test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    assertSourceChosen(test);
    const section = await this.requireSection(test.baseConfigId, body.baseConfigSectionId);
    const assignee = await this.requireAssignee(body.assigneeId);
    await this.assertHoldsFeature(assignee, body.role);
    await this.assertNotTheOtherRole(testId, section.id, body.assigneeId, body.role);

    const pair = { testId, baseConfigSectionId: section.id };

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Test before its rows, the app's one lock order: an edit reopening this holder took the test first.
        await beginDraftPaperEdit(tx, testId, OFFERED_MESSAGE);

        // Read under the lock, so a reopen or a Done that landed since the checks carries over as it is now.
        const holding = await tx.questionAssignment.findFirst({
          where: { ...pair, role: body.role, replacedAt: null },
        });
        if (holding?.assigneeId === body.assigneeId) {
          throw new AppException(ErrorCodes.VALIDATION_ERROR, ALREADY_HOLDS_MESSAGE, {
            fieldErrors: { assigneeId: [ALREADY_HOLDS_MESSAGE] },
          });
        }
        // The section's progress belongs to the role, not the person: it carries over to whoever takes it.
        const handedAt = holding ? holding.handedAt : await handedOnArrival(tx, pair, body.role);
        if (holding) {
          await tx.questionAssignment.update({
            where: { id: holding.id },
            data: { replacedAt: new Date() },
          });
        }
        return tx.questionAssignment.create({
          data: {
            ...pair,
            baseConfigId: test.baseConfigId,
            assigneeId: body.assigneeId,
            role: body.role,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            finalizedAt: holding?.finalizedAt ?? null,
            handedAt,
            createdById: actorId,
          },
          include: ASSIGNMENT_INCLUDE,
        });
      });
      return this.withWrittenCount(row);
    } catch (error) {
      // Two admins raced the same section; the unique picked one. The loser is told why, not how.
      if (!isUniqueViolation(error)) throw error;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `That section already has a ${roleLabel(body.role)}`,
      );
    }
  }

  /** Work done is a record: only a row nothing has been done under can be taken back. */
  async remove(testId: string, id: string): Promise<void> {
    const row = await this.prisma.questionAssignment.findFirst({
      where: { id, testId },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    if (row.replacedAt) {
      const ended = inScope(row) ? REPLACED_MESSAGE : SECTION_DROPPED_MESSAGE;
      throw new AppException(ErrorCodes.CONFLICT, ended);
    }
    if (!(await this.removable(row))) {
      throw new AppException(ErrorCodes.CONFLICT, HAS_WORKED_MESSAGE);
    }
    await this.prisma.questionAssignment.delete({ where: { id } });
  }

  /** Typed, edited, reviewed, commented or finished anything on the section: then it is a record. */
  private async removable(row: RemovableRow): Promise<boolean> {
    return (await this.removableIds([row])).has(row.id);
  }

  /** The same six checks for a whole page at once — six reads, not six per row. */
  private async removableIds(rows: readonly RemovableRow[]): Promise<Set<string>> {
    const open = rows.filter((row) => !row.finalizedAt && !row.replacedAt);
    if (open.length === 0) return new Set();

    const onSection = await this.questionsOn(sectionPairs(open));
    const worked = await this.handsThatWorked(open, onSection);
    return new Set(open.filter((row) => !worked.has(row.id)).map((row) => row.id));
  }

  /** Every question a section holds, placed on its paper or typed under its typist. */
  private async questionsOn(pairs: readonly SectionPair[]): Promise<ReadonlyMap<string, string[]>> {
    // Two indexed reads: one OR across both relations planned as a scan of the whole bank.
    const [placed, typedHere] = await Promise.all([
      this.prisma.paperQuestion.findMany({
        where: { OR: [...pairs] },
        select: { testId: true, baseConfigSectionId: true, questionId: true },
      }),
      this.prisma.question.findMany({
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
  private async handsThatWorked(
    open: readonly RemovableRow[],
    onSection: ReadonlyMap<string, string[]>,
  ): Promise<ReadonlySet<string>> {
    const pairs = [...sectionPairs(open)];
    const who = [...new Set(open.map((row) => row.assigneeId))];
    const since = new Date(Math.min(...open.map((row) => row.createdAt.getTime())));
    const onAnySection = [...new Set([...onSection.values()].flat())];

    const [typed, reviewed, said, edited] = await Promise.all([
      this.prisma.question.groupBy({
        by: ['assignmentId'],
        where: { assignmentId: { in: open.map((row) => row.id) } },
        _count: true,
      }),
      this.prisma.questionReview.findMany({
        where: { AND: [{ OR: pairs }, { OR: reviewedByAnyOf(who) }] },
        select: REVIEW_HAND_SELECT,
      }),
      this.prisma.sectionComment.groupBy({
        by: ['testId', 'baseConfigSectionId', 'authorId'],
        where: { AND: [{ OR: pairs }, { authorId: { in: who } }] },
        _count: true,
      }),
      // The latest edit per question and admin: a row is a record once one lands after it began.
      this.prisma.rowActionLog.groupBy({
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

  /** One admin's own rows, whichever role they came in as. Their work, and their actions. */
  async mine(adminId: string, query: MineAssignmentsQuery): Promise<Paginated<AssignmentWithTest>> {
    const due = dueBounds(query);
    const where: Prisma.QuestionAssignmentWhereInput = {
      assigneeId: adminId,
      ...(query.outstanding ? { finalizedAt: null, replacedAt: null } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.testId ? { testId: query.testId } : {}),
      ...(query.baseConfigSectionId ? { baseConfigSectionId: query.baseConfigSectionId } : {}),
      ...(due
        ? { dueAt: { ...(due.from ? { gte: due.from } : {}), ...(due.to ? { lte: due.to } : {}) } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.questionAssignment.findMany({
        where,
        include: WITH_TEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.questionAssignment.count({ where }),
    ]);
    // The whole page's release counts at once: one reading per row was three statements each.
    const [written, counted] = await Promise.all([
      this.sectionWrittenCounts(rows),
      this.releaseCounts(rows.filter((row) => readOpen(row))),
    ]);
    return paged(
      query,
      rows.map((row) =>
        toAssignmentWithTest(
          row,
          written.get(sectionKey(row)) ?? NO_COUNTS,
          readOpen(row) && gapFrom(counted.get(sectionKey(row)), row) === null,
        ),
      ),
      total,
    );
  }

  /** Expanded in memory: the cross of unfrozen tests and their sections is thousands of rows here, not millions. */
  async progress(query: SectionProgressQuery): Promise<Paginated<SectionProgressRow>> {
    const due = dueBounds(query);
    const tests = await this.prisma.test.findMany({
      where: {
        ...UNFROZEN_TEST,
        ...(query.testId ? { id: query.testId } : {}),
      },
      select: TEST_QUEUE_SELECT,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });

    const rows = tests
      .flatMap((test) =>
        sectionsOf(test)
          .filter(
            (section) => !query.baseConfigSectionId || section.id === query.baseConfigSectionId,
          )
          .map((section) => sectionRow(test, section)),
      )
      .filter((row) => !query.assigneeId || heldByAnyOf(row, query.assigneeId))
      .filter((row) => !due || dueWithin(row, due));

    const { skip, take } = pageArgs(query);
    const items = rows.slice(skip, skip + take);
    const written = await this.sectionWrittenCounts(items);
    return paged(
      query,
      items.map((row) => ({
        ...row,
        writtenCount: (written.get(sectionKey(row)) ?? NO_COUNTS).writtenCount,
      })),
      rows.length,
    );
  }

  /** What a test picker offers: their own tests, or every unfrozen one when a super admin asks. */
  async tests(
    query: AssignmentTestsQuery,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<Paginated<AssignmentTest>> {
    const where: Prisma.TestWhereInput = {
      ...UNFROZEN_TEST,
      ...(ownScope(query, isSuperAdmin) ? { assignments: { some: heldBy(adminId, query) } } : {}),
      ...everyTermMatches<Prisma.TestWhereInput>(query.q, (term) => [
        { title: { contains: term, mode: 'insensitive' } },
      ]),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.test.findMany({
        where,
        select: { id: true, title: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.test.count({ where }),
    ]);
    return paged(query, rows, total);
  }

  /** The chosen test's sections, in the test's own order — a dozen rows, so no page to ask for. */
  async sectionChoices(
    testId: string,
    query: AssignmentSectionsQuery,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<AssignmentSection[]> {
    if (ownScope(query, isSuperAdmin)) {
      const held = await this.prisma.questionAssignment.findMany({
        where: { testId, ...heldBy(adminId, query) },
        select: { baseConfigSection: { select: { id: true, name: true } } },
        orderBy: { baseConfigSection: { order: 'asc' } },
      });
      return held.map((row) => row.baseConfigSection);
    }

    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: TEST_QUEUE_SELECT,
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return sectionsOf(test).map((section) => ({ id: section.id, name: section.name }));
  }

  /** A reader's release, by the row the section resolved. Idempotent: a repeat restamps. A typist uses Done. */
  async finalize(id: string): Promise<Assignment> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    if (row.role === ASSIGNMENT_ROLES.TYPIST) {
      throw new AppException(ErrorCodes.CONFLICT, CHOOSE_WITH_DONE_MESSAGE);
    }
    if (row.replacedAt) {
      throw new AppException(
        ErrorCodes.CONFLICT,
        inScope(row) ? PASSED_ON_MESSAGE : LEFT_TEST_MESSAGE,
      );
    }
    if (!row.handedAt) throw notWhole(NOT_HANDED_MESSAGE);
    if (row.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, READING_OVER_MESSAGE);
    const section = { testId: row.testId, baseConfigSectionId: row.baseConfigSectionId };
    const gap = await this.releaseGap(
      section,
      row.test.paperSource,
      row.baseConfigSection.questionCount,
    );
    if (gap) throw notWhole(gap);

    // Re-reading is the same fact restated: the stamp moves, so a section read again is covered again.
    const updated = await this.prisma.questionAssignment.update({
      where: { id },
      data: { finalizedAt: new Date() },
      include: ASSIGNMENT_INCLUDE,
    });
    return this.withWrittenCount(updated);
  }

  /** Why a reader cannot release the section yet, or null once they can: whole at its count, and every question checked. */
  async releaseGap(
    section: { testId: string; baseConfigSectionId: string },
    paperSource: PaperSource | null,
    needed: number,
  ): Promise<string | null> {
    const counted = await this.releaseCounts([{ ...section, test: { paperSource } }]);
    return releaseGapOf(counted.get(sectionKey(section)) ?? NO_RELEASE_COUNTS, needed);
  }

  /** The three counts a release turns on, for every section named at once — a page of the queue asked one section at a time was three statements a row. */
  private async releaseCounts(
    rows: readonly (SectionPair & { test: { paperSource: PaperSource | null } })[],
  ): Promise<Map<string, ReleaseCounts>> {
    const sections = sectionPairs(rows);
    if (sections.length === 0) return new Map();

    // A picked section's typist only fixes what comes back, so it never finishes the section.
    const typed = sectionPairs(rows.filter((row) => row.test.paperSource === PAPER_SOURCES.FRAMED));
    const [typing, onPaper, unchecked] = await Promise.all([
      typed.length === 0
        ? []
        : this.prisma.questionAssignment.groupBy({
            by: ['testId', 'baseConfigSectionId'],
            where: {
              OR: typed,
              role: ASSIGNMENT_ROLES.TYPIST,
              finalizedAt: null,
              replacedAt: null,
            },
            _count: { _all: true },
          }),
      this.prisma.paperQuestion.groupBy({
        by: ['testId', 'baseConfigSectionId'],
        where: { OR: sections },
        _count: { _all: true },
      }),
      this.prisma.paperQuestion.groupBy({
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
  private async sectionWrittenCounts(
    rows: readonly { testId: string; baseConfigSectionId: string }[],
  ): Promise<Map<string, SectionCounts>> {
    const sections = [...new Map(rows.map((row) => [sectionKey(row), row])).values()];
    if (sections.length === 0) return new Map();

    const held = await this.prisma.questionAssignment.findMany({
      where: {
        OR: sections.map(({ testId, baseConfigSectionId }) => ({ testId, baseConfigSectionId })),
      },
      select: { id: true, testId: true, baseConfigSectionId: true },
    });
    const ids = held.map((row) => row.id);
    const written =
      ids.length === 0
        ? []
        : await this.prisma.question.groupBy({
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

  private async withWrittenCount(row: AssignmentRow): Promise<Assignment> {
    const counts = await this.sectionWrittenCounts([row]);
    return toAssignment(row, counts.get(sectionKey(row)) ?? NO_COUNTS);
  }

  private async requireTest(id: string): Promise<{
    id: string;
    baseConfigId: string;
    paperSource: PaperSource | null;
    finalizedAt: Date | null;
  }> {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: { id: true, baseConfigId: true, paperSource: true, finalizedAt: true },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }

  private async requireSection(baseConfigId: string, id: string): Promise<{ id: string }> {
    const section = await this.prisma.baseConfigSection.findFirst({
      where: { id, baseConfigId },
      select: { id: true },
    });
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, 'No such section');
    return section;
  }

  private async requireAssignee(id: string): Promise<{ id: string; name: string }> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true },
    });
    if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'No such admin');
    return { id: admin.id, name: admin.fullName ?? admin.email };
  }

  private async assertHoldsFeature(
    assignee: { id: string; name: string },
    role: AssignmentRole,
  ): Promise<void> {
    const key = FEATURE_FOR_ROLE[role];
    const permissions = await this.admins.permissionsFor(assignee.id);
    if (satisfiesLevel(permissions[key], PERMISSION_LEVELS.WRITE)) return;

    const message = `${assignee.name} does not hold ${FEATURES[key].label} access`;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { assigneeId: [message] },
    });
  }

  /** Spec §11's convention, made real: nobody checks their own typing on the same section. */
  private async assertNotTheOtherRole(
    testId: string,
    sectionId: string,
    assigneeId: string,
    role: AssignmentRole,
  ): Promise<void> {
    const clash = await this.prisma.questionAssignment.findFirst({
      where: { testId, baseConfigSectionId: sectionId, role: otherRole(role), replacedAt: null },
      select: { assigneeId: true },
    });
    if (clash?.assigneeId !== assigneeId) return;

    const message =
      role === ASSIGNMENT_ROLES.PROOFREADER
        ? 'This admin is already the typist on this section'
        : 'This admin is already the proof-reader on this section';
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { assigneeId: [message] },
    });
  }
}

/** A super admin reads the whole institute unless they ask for their own queue; nobody else ever does. */
const ownScope = (query: { mine?: boolean }, isSuperAdmin: boolean): boolean =>
  !isSuperAdmin || query.mine === true;

const heldBy = (
  adminId: string,
  query: { role?: AssignmentRole },
): Prisma.QuestionAssignmentWhereInput => ({
  assigneeId: adminId,
  ...(query.role ? { role: query.role } : {}),
});

/** One row per (test, section), carrying both halves of its work — never one row per role. */
function sectionRow(test: QueueTest, section: QueueSection): SectionProgressRow {
  return {
    testId: test.id,
    testTitle: test.title,
    baseConfigSectionId: section.id,
    sectionName: section.name,
    ...NO_COUNTS,
    sectionQuestionCount: section.questionCount,
    typing: roleProgress(test, section, ASSIGNMENT_ROLES.TYPIST),
    reading: roleProgress(test, section, ASSIGNMENT_ROLES.PROOFREADER),
  };
}

/** A section is only unique within its own test — two tests can share a base config's section id. */
const sectionKey = (row: { testId: string; baseConfigSectionId: string }): string =>
  `${row.testId}:${row.baseConfigSectionId}`;

/** One admin's hands on one thing, so a section's and a question's work read out of one set. */
const handKey = (what: string, adminId: string): string => `${what}|${adminId}`;

interface SectionPair {
  testId: string;
  baseConfigSectionId: string;
}

/** A `groupBy` over (test, section) as a lookup on the key the rest of this file uses. */
const sectionCountsIn = (
  groups: readonly (SectionPair & { _count: { _all: number } })[],
): Map<string, number> => new Map(groups.map((group) => [sectionKey(group), group._count._all]));

/** What a release turns on: typing still open on the section, its rows on the paper, and the unchecked ones among them. */
interface ReleaseCounts {
  typing: number;
  onPaper: number;
  unchecked: number;
}

const NO_RELEASE_COUNTS: ReleaseCounts = { typing: 0, onPaper: 0, unchecked: 0 };

function releaseGapOf(counts: ReleaseCounts, needed: number): string | null {
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
const gapFrom = (
  counts: ReleaseCounts | undefined,
  row: { baseConfigSection: { questionCount: number } },
): string | null => releaseGapOf(counts ?? NO_RELEASE_COUNTS, row.baseConfigSection.questionCount);

/** What `removable` is decided on, whichever read the row came off. */
interface RemovableRow extends SectionPair {
  id: string;
  assigneeId: string;
  finalizedAt: Date | null;
  replacedAt: Date | null;
  createdAt: Date;
}

const sectionPairs = (rows: readonly SectionPair[]): SectionPair[] =>
  [...new Map(rows.map((row) => [sectionKey(row), row])).values()].map(
    ({ testId, baseConfigSectionId }) => ({ testId, baseConfigSectionId }),
  );

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

/** What a section holds, counted across every assignment on it. */
export interface SectionCounts {
  writtenCount: number;
}

const NO_COUNTS: SectionCounts = { writtenCount: 0 };

function toAssignment(
  row: AssignmentRow,
  counts: SectionCounts,
  removable: boolean | null = null,
): Assignment {
  return {
    id: row.id,
    testId: row.testId,
    baseConfigSectionId: row.baseConfigSectionId,
    sectionName: row.baseConfigSection.name,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee.fullName ?? row.assignee.email,
    role: row.role,
    dueAt: row.dueAt?.toISOString() ?? null,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    writtenCount: counts.writtenCount,
    canMarkDone: doneOpen(row),
    canMarkRead: readOpen(row),
    testOffered: row.test.finalizedAt !== null,
    handedAt: row.handedAt?.toISOString() ?? null,
    replacedAt: row.replacedAt?.toISOString() ?? null,
    sectionDropped: row.replacedAt !== null && !inScope(row),
    removable,
    sectionQuestionCount: row.baseConfigSection.questionCount,
    sectionMix: sectionMixOf(row.test.questionPoolFilter, row.baseConfigSectionId),
    sectionSubjectId: row.baseConfigSection.subjectId,
  };
}

/** Whether the test still covers the row's section; a narrower scope stands its holders down. */
function inScope(row: Pick<AssignmentRow, 'baseConfigSection' | 'test'>): boolean {
  return scopedSections([row.baseConfigSection], row.test.scope, scopeRefOf(row.test)).length > 0;
}

/** Absent means the section draws every difficulty, not zero of each — never defaulted here. */
function sectionMixOf(questionPoolFilter: unknown, sectionId: string): DifficultyMix | null {
  const spec = questionPoolFilter as DrawSpec | null;
  return spec?.sections?.[sectionId]?.mix ?? null;
}

function toAssignmentWithTest(
  row: AssignmentWithTestRow,
  counts: SectionCounts,
  canRelease: boolean,
): AssignmentWithTest {
  return { ...toAssignment(row, counts), testTitle: row.test.title, canRelease };
}

/** A reader given a typed section its typist has already finished starts with it in hand. */
async function handedOnArrival(
  db: Pick<Prisma.TransactionClient, 'questionAssignment'>,
  pair: { testId: string; baseConfigSectionId: string },
  role: AssignmentRole,
): Promise<Date | null> {
  if (role !== ASSIGNMENT_ROLES.PROOFREADER) return null;
  const typing = await db.questionAssignment.findFirst({
    where: {
      ...pair,
      role: ASSIGNMENT_ROLES.TYPIST,
      replacedAt: null,
      finalizedAt: { not: null },
      test: { paperSource: PAPER_SOURCES.FRAMED },
    },
    select: { id: true },
  });
  return typing ? new Date() : null;
}
