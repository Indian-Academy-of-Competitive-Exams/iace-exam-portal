import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ROLES,
  ASSIGNMENT_ROLES,
  ASSIGNMENT_SUMMARY_NEXT_ROWS,
  AppException,
  DUE_STANDINGS,
  ErrorCodes,
  FEATURES,
  FEATURE_KEYS,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  civilDate,
  fieldDiff,
  satisfiesLevel,
  scopedSections,
  todayISO,
  type AdminRole,
  type Assignment,
  type AssignableAdmin,
  type AssignmentRole,
  type AssignmentSummary,
  type AssignmentWithTest,
  type ChangeAssignmentDueBody,
  type CreateAssignmentBody,
  type DifficultyMix,
  type DrawSpec,
  type FeatureKey,
  type MineAssignmentsQuery,
  type Paginated,
  type PaperSource,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditContext } from '../audit';
import { AdminsService } from '../admins';
import { isUniqueViolation } from '../common/prisma-errors';
import { scopeRefOf } from '../common/prisma-json';
import { releaseSectionEditLock } from '../common/edit-lock';
import { assertSourceChosen, beginDraftPaperEdit } from '../common/paper-edit';
import { pageArgs, paged } from '../common/pagination';
import { endOfInstituteDay } from '../common/time/institute-day';
import {
  NO_RELEASE_COUNTS,
  factsOf,
  gapFrom,
  releaseCounts,
  releaseGapOf,
  sectionKey,
  seatKey,
  spentSeconds,
  type RowFacts,
} from './assignment-counts';
import { removableIds, type RemovableRow } from './assignment-removal';
import { dueBounds } from './section-progress.service';
import { OWED_WHERE, doneOpen, finishes, owed, readOpen, standingOf } from './assignment-gates';
import { formRefusal } from '../common/form-refusal';

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
const DUE_DAY_GONE_MESSAGE = 'Choose today or a later day.';
const OFFERED_DUE_MESSAGE =
  'This test has been offered, so the day its sections are wanted by no longer moves.';
const FINISHED_DUE_MESSAGE =
  'This section is already finished, so the day it was wanted by stays as it was.';
const TYPED_HERE_MESSAGE =
  'This admin typed questions for this section, so they cannot proof-read it.';

const notWhole = (issue: string) => formRefusal(ErrorCodes.CONFLICT, issue);

function assertDueDayNotGone(dueAt: string): void {
  if (dueAt >= todayISO()) return;
  throw new AppException(ErrorCodes.VALIDATION_ERROR, DUE_DAY_GONE_MESSAGE, {
    fieldErrors: { dueAt: [DUE_DAY_GONE_MESSAGE] },
  });
}

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

/** What one admin's standing is counted from: no section fact, so no count beside it. */
const SUMMARY_SELECT = {
  id: true,
  role: true,
  testId: true,
  baseConfigSectionId: true,
  assigneeId: true,
  dueAt: true,
  finalizedAt: true,
  replacedAt: true,
  baseConfigSection: { select: { name: true } },
  test: { select: { title: true, finalizedAt: true, paperSource: true } },
} as const satisfies Prisma.QuestionAssignmentSelect;

type SummaryRow = Prisma.QuestionAssignmentGetPayload<{ select: typeof SUMMARY_SELECT }>;

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
    private readonly redis: RedisService,
    private readonly auditContext: AuditContext,
  ) {}

  /** Every assignment on the test, section and assignee named, one query. */
  async forTest(testId: string, viewer: TimeViewer): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ baseConfigSection: { order: 'asc' } }, { role: 'asc' }],
    });
    const [facts, removable] = await Promise.all([
      factsOf(this.prisma, rows),
      removableIds(this.prisma, rows),
    ]);
    return sentTo(
      viewer,
      rows.map((row) => toAssignment(row, facts(row), removable.has(row.id))),
    );
  }

  /** Every row on one section, the replaced ones included, oldest first — the section's own record. */
  async sectionAssignments(
    testId: string,
    baseConfigSectionId: string,
    viewer: TimeViewer,
  ): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId, baseConfigSectionId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const facts = await factsOf(this.prisma, rows);
    return sentTo(
      viewer,
      rows.map((row) => toAssignment(row, facts(row))),
    );
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
    assertDueDayNotGone(body.dueAt);
    const [sectionResult, assigneeResult] = await Promise.allSettled([
      this.requireSection(test, body.baseConfigSectionId),
      this.requireAssignee(body.assigneeId),
    ]);
    if (sectionResult.status === 'rejected') throw sectionResult.reason;
    if (assigneeResult.status === 'rejected') throw assigneeResult.reason;
    const section = sectionResult.value;
    const assignee = assigneeResult.value;

    const [featureResult, roleResult] = await Promise.allSettled([
      this.assertHoldsFeature(assignee, body.role),
      this.assertNotTheOtherRole(testId, section.id, body.assigneeId, body.role),
    ]);
    if (featureResult.status === 'rejected') throw featureResult.reason;
    if (roleResult.status === 'rejected') throw roleResult.reason;

    const pair = { testId, baseConfigSectionId: section.id };

    try {
      const { row, replaced } = await this.prisma.$transaction(async (tx) => {
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
        const row = await tx.questionAssignment.create({
          data: {
            ...pair,
            baseConfigId: test.baseConfigId,
            assigneeId: body.assigneeId,
            role: body.role,
            dueAt: endOfInstituteDay(body.dueAt),
            finalizedAt: holding?.finalizedAt ?? null,
            handedAt,
            createdById: actorId,
          },
          include: ASSIGNMENT_INCLUDE,
        });
        return { row, replaced: holding?.assigneeId };
      });
      // The earlier holder only reads now, so a claim they left must not keep the new one out.
      if (replaced) await releaseSectionEditLock(this.redis, pair, replaced);
      // Whoever assigns may hold the other seat on this section, so the answer carries nobody's time.
      return { ...(await this.withFacts(row)), secondsSpent: null };
    } catch (error) {
      // Two admins raced the same section; the unique picked one. The loser is told why, not how.
      if (!isUniqueViolation(error)) throw error;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `That section already has a ${roleLabel(body.role)}`,
      );
    }
  }

  /** The holder keeps the seat and only its day moves: no new row, and the role is not passed on. */
  async changeDueDay(
    testId: string,
    id: string,
    body: ChangeAssignmentDueBody,
  ): Promise<Assignment> {
    assertDueDayNotGone(body.dueAt);

    const { row, held } = await this.prisma.$transaction(async (tx) => {
      // Test before its rows, the app's one lock order: a hand-over of this seat takes it first too.
      await beginDraftPaperEdit(tx, testId, OFFERED_DUE_MESSAGE);

      const held = await tx.questionAssignment.findFirst({
        where: { id, testId },
        include: ASSIGNMENT_INCLUDE,
      });
      if (!held) throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
      if (held.replacedAt) {
        const ended = inScope(held) ? REPLACED_MESSAGE : SECTION_DROPPED_MESSAGE;
        throw new AppException(ErrorCodes.CONFLICT, ended);
      }
      // A finished seat's standing is read off this day, so moving it would rewrite who was late.
      if (held.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, FINISHED_DUE_MESSAGE);
      const row = await tx.questionAssignment.update({
        where: { id },
        data: { dueAt: endOfInstituteDay(body.dueAt) },
        include: ASSIGNMENT_INCLUDE,
      });
      return { row, held };
    });

    const moved = fieldDiff(
      { dueAt: held.dueAt ? civilDate(held.dueAt) : null },
      { dueAt: body.dueAt },
      ['dueAt'],
    );
    this.auditContext.setEntityId(testId);
    this.auditContext.setPatchDiff(
      moved && {
        section: { from: null, to: held.baseConfigSection.name },
        role: { from: null, to: roleLabel(held.role) },
        ...moved,
      },
    );
    // Whoever moves it may hold the other seat on this section, so the answer carries nobody's time.
    return { ...(await this.withFacts(row)), secondsSpent: null };
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
    return (await removableIds(this.prisma, [row])).has(row.id);
  }

  /** One admin's own rows, whichever role they came in as. Their work, and their actions. */
  async mine(adminId: string, query: MineAssignmentsQuery): Promise<Paginated<AssignmentWithTest>> {
    const due = dueBounds(query);
    const where: Prisma.QuestionAssignmentWhereInput = {
      assigneeId: adminId,
      ...(query.outstanding ? OWED_WHERE : {}),
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
    const [facts, counted] = await Promise.all([
      factsOf(this.prisma, rows),
      releaseCounts(
        this.prisma,
        rows.filter((row) => readOpen(row)),
      ),
    ]);
    return paged(
      query,
      rows.map((row) =>
        toAssignmentWithTest(
          row,
          facts(row),
          readOpen(row) && gapFrom(counted.get(sectionKey(row)), row) === null,
        ),
      ),
      total,
    );
  }

  /** One admin's standing on the sections they hold now, and the ones still owed. Undefined while they hold none. */
  async summary(adminId: string): Promise<AssignmentSummary | undefined> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { assigneeId: adminId, replacedAt: null },
      select: SUMMARY_SELECT,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    if (rows.length === 0) return undefined;

    const spent = await spentSeconds(this.prisma, rows);
    const secondsOn = (row: SummaryRow) => spent.get(seatKey(row)) ?? 0;
    const today = todayISO();
    const roles = Object.values(ASSIGNMENT_ROLES).flatMap((role) => {
      const held = rows.filter((row) => row.role === role);
      if (held.length === 0) return [];
      const standings = held.map((row) => standingOf(row, today));
      const standing = (wanted: string) => standings.filter((one) => one === wanted).length;
      return [
        {
          role,
          // Only what has a finish to give: a picked paper's typist is not behind on a Done they cannot make.
          assigned: held.filter(finishes).length,
          completed: held.filter((row) => row.finalizedAt !== null).length,
          onTime: standing(DUE_STANDINGS.ON_TIME),
          overdue: standing(DUE_STANDINGS.OVERDUE),
          secondsSpent: held.reduce((sum, row) => sum + secondsOn(row), 0),
        },
      ];
    });
    const next = rows
      .filter(owed)
      .slice(0, ASSIGNMENT_SUMMARY_NEXT_ROWS)
      .map((row) => ({
        assignmentId: row.id,
        testId: row.testId,
        testTitle: row.test.title,
        baseConfigSectionId: row.baseConfigSectionId,
        sectionName: row.baseConfigSection.name,
        role: row.role,
        dueAt: row.dueAt?.toISOString() ?? null,
        standing: standingOf(row, today),
        secondsSpent: secondsOn(row),
      }));
    return { roles, next };
  }

  /** A reader's release, by the row the section resolved. Idempotent: a repeat leaves the first stamp. A typist uses Done. */
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

    const updated = await this.prisma.$transaction(async (tx) => {
      // The row every review write and paper edit takes, so the gap read here is the gap the stamp lands on.
      await beginDraftPaperEdit(tx, row.testId, READING_OVER_MESSAGE);
      const held = await tx.questionAssignment.findUniqueOrThrow({
        where: { id },
        include: ASSIGNMENT_INCLUDE,
      });
      // A reopen clears the stamp, so one still standing is the finish its due day is judged by.
      if (held.finalizedAt) return held;

      const gap = await this.releaseGap(
        section,
        row.test.paperSource,
        row.baseConfigSection.questionCount,
        tx,
      );
      if (gap) throw notWhole(gap);
      return tx.questionAssignment.update({
        where: { id },
        data: { finalizedAt: new Date() },
        include: ASSIGNMENT_INCLUDE,
      });
    }, TX_LIMITS.SHORT);
    return this.withFacts(updated);
  }

  /** Why a reader cannot release the section yet, or null once they can: whole at its count, and every question checked. */
  async releaseGap(
    section: { testId: string; baseConfigSectionId: string },
    paperSource: PaperSource | null,
    needed: number,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    const counted = await releaseCounts(db, [{ ...section, test: { paperSource } }]);
    return releaseGapOf(counted.get(sectionKey(section)) ?? NO_RELEASE_COUNTS, needed);
  }

  private async withFacts(row: AssignmentRow): Promise<Assignment> {
    return toAssignment(row, (await factsOf(this.prisma, [row]))(row));
  }

  private async requireTest(id: string) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: {
        id: true,
        baseConfigId: true,
        paperSource: true,
        finalizedAt: true,
        scope: true,
        scopeRef: true,
      },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }

  /** A section the test's scope leaves out is no part of its paper, so nobody is given it. */
  private async requireSection(
    test: ScopedTest & { baseConfigId: string },
    id: string,
  ): Promise<{ id: string }> {
    const baseConfigSection = await this.prisma.baseConfigSection.findFirst({
      where: { id, baseConfigId: test.baseConfigId },
      select: { id: true, moduleId: true, questionCount: true },
    });
    if (!baseConfigSection || !inScope({ baseConfigSection, test })) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such section');
    }
    return baseConfigSection;
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
    const pair = { testId, baseConfigSectionId: sectionId };
    const refused = (message: string) =>
      new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { assigneeId: [message] },
      });

    const [clash, typed] = await Promise.all([
      this.prisma.questionAssignment.findFirst({
        where: { ...pair, role: otherRole(role), replacedAt: null },
        select: { assigneeId: true },
      }),
      role === ASSIGNMENT_ROLES.PROOFREADER
        ? this.prisma.question.findFirst({
            where: {
              createdById: assigneeId,
              assignment: { ...pair, role: ASSIGNMENT_ROLES.TYPIST },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (clash?.assigneeId === assigneeId) {
      throw refused(
        role === ASSIGNMENT_ROLES.PROOFREADER
          ? 'This admin is already the typist on this section'
          : 'This admin is already the proof-reader on this section',
      );
    }
    // A typist whose role passed on as well: what they wrote for the section is still their own typing.
    if (typed) throw refused(TYPED_HERE_MESSAGE);
  }
}

/** Whoever a read is for, as far as another seat's time goes. */
interface TimeViewer {
  id: string;
  isSuperAdmin?: boolean;
}

/** A seat holder is sent their own time on that section and nobody else's; anybody else there is its owner. */
function sentTo(viewer: TimeViewer, rows: readonly Assignment[]): Assignment[] {
  if (viewer.isSuperAdmin) return [...rows];
  const seated = new Set(rows.filter((row) => row.assigneeId === viewer.id).map(sectionKey));
  return rows.map((row) =>
    seated.has(sectionKey(row)) && row.assigneeId !== viewer.id
      ? { ...row, secondsSpent: null }
      : row,
  );
}

function toAssignment(
  row: AssignmentRow,
  facts: RowFacts,
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
    standing: standingOf(row),
    secondsSpent: facts.secondsSpent,
    writtenCount: facts.writtenCount,
    canMarkDone: doneOpen(row),
    canMarkRead: readOpen(row),
    testOffered: row.test.finalizedAt !== null,
    paperSource: row.test.paperSource,
    handedAt: row.handedAt?.toISOString() ?? null,
    replacedAt: row.replacedAt?.toISOString() ?? null,
    sectionDropped: row.replacedAt !== null && !inScope(row),
    removable,
    sectionQuestionCount: row.baseConfigSection.questionCount,
    sectionMix: sectionMixOf(row.test.questionPoolFilter, row.baseConfigSectionId),
    sectionSubjectId: row.baseConfigSection.subjectId,
  };
}

/** What a test's scope is read from, and what the scope rule asks of a section. */
type ScopedTest = Pick<AssignmentRow['test'], 'scope' | 'scopeRef'>;
type ScopedSection = Parameters<typeof scopedSections>[0][number];

/** Whether the test still covers the row's section; a narrower scope stands its holders down. */
function inScope(row: { baseConfigSection: ScopedSection; test: ScopedTest }): boolean {
  return scopedSections([row.baseConfigSection], row.test.scope, scopeRefOf(row.test)).length > 0;
}

/** Absent means the section draws every difficulty, not zero of each — never defaulted here. */
function sectionMixOf(questionPoolFilter: unknown, sectionId: string): DifficultyMix | null {
  const spec = questionPoolFilter as DrawSpec | null;
  return spec?.sections?.[sectionId]?.mix ?? null;
}

function toAssignmentWithTest(
  row: AssignmentWithTestRow,
  facts: RowFacts,
  canRelease: boolean,
): AssignmentWithTest {
  return { ...toAssignment(row, facts), testTitle: row.test.title, canRelease };
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
