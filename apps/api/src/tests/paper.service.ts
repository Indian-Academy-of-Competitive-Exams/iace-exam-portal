import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ASSIGNMENT_ROLES,
  DIFFICULTY_LEVELS,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_STATUS,
  type BaseConfigDetail,
  quotaWithPicks,
  sectionQuota,
  type DifficultyMix,
  type DrawSpec,
  type SectionDrawSpec,
  type SectionQuota,
  type AddPaperQuestionBody,
  type ReplacePaperQuestionBody,
  type SetPaperQuestionStatusBody,
  type TestPaper,
  type LocalizedContent,
  type PaperSource,
  type TestScope,
  type TestScopeRef,
  scopedSections,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BaseConfigsService } from '../configs';
import {
  drawSection,
  narrows,
  type DrawCandidate,
  type DrawnQuestion,
  type DrawSection,
} from './draw-engine';
import { OFFERED_TEST_MESSAGE, SAT_TEST_MESSAGE } from './test-rules';
import { beginPaperEdit } from './begin-paper-edit';
import { takeTestEditLock, type Editor } from './edit-lock';
import { DRAWABLE_QUESTION, stemPreviewOf } from '../questions';
import { ScoringOutbox } from '../attempts';
import { AuditContext } from '../audit';

const NOT_DRAWABLE_MESSAGE =
  'That question is archived, or has no version to pin, so no paper can serve it.';
const WRONG_SUBJECT_MESSAGE = 'That question belongs to another subject than this section draws.';
const ALREADY_ON_THE_PAPER_MESSAGE = 'That question is already on this paper.';
const NOT_FROZEN_MESSAGE =
  'Only an offered test can have a question dropped or made a bonus. Edit the paper before offering it instead.';
const NO_SUCH_SECTION_MESSAGE = 'No such section on this paper';
const SOURCE_UNCHOSEN_MESSAGE =
  'This test has not said where its questions come from yet. Choose that before picking any.';
const SECTION_TOO_THIN_MESSAGE =
  'The bank does not hold enough questions to fill the rest of this section.';

const overSplitMessage = (sectionName: string) =>
  `${sectionName} already holds more of one difficulty than its split allows. Take one off first.`;

const CANDIDATE_SELECT = {
  id: true,
  currentVersionId: true,
  subjectId: true,
  topicId: true,
  difficulty: true,
  tags: true,
} as const satisfies Prisma.QuestionSelect;

type CandidateRow = Prisma.QuestionGetPayload<{ select: typeof CANDIDATE_SELECT }>;

const HELD_SELECT = {
  order: true,
  baseConfigSectionId: true,
  questionId: true,
  questionVersionId: true,
} as const satisfies Prisma.PaperQuestionSelect;

type HeldRow = Prisma.PaperQuestionGetPayload<{ select: typeof HELD_SELECT }>;

const PAPER_INCLUDE = {
  question: {
    select: {
      id: true,
      questionCode: true,
      difficulty: true,
      subjectId: true,
      topicId: true,
      // The stem, so the paper reads like the bank beside it rather than like a list of codes.
      currentVersion: { select: { content: true } },
    },
  },
} as const satisfies Prisma.PaperQuestionInclude;

/** A test's paper: read, or built a question or a section at a time until the freeze. */
@Injectable()
export class PaperService {
  private readonly logger = new Logger(PaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: BaseConfigsService,
    private readonly outbox: ScoringOutbox,
    private readonly auditContext: AuditContext,
    private readonly redis: RedisService,
  ) {}

  async read(testId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    const config = await this.configs.detail(test.baseConfigId);
    return this.paperOf(test.id, this.scopedOf(test, config));
  }

  /** Several at once, numbered from the section's current highest order; every one resolved and checked before any write. */
  async addQuestions(
    testId: string,
    input: AddPaperQuestionBody,
    editor: Editor = {},
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    await takeTestEditLock(this.redis, this.prisma, testId, editor);
    this.assertAssemblable(test);
    assertSourceChosen(test);

    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find((row) => row.id === input.baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);
    await this.assertSectionsNotAssigned(testId, [section.id], editor.isSuperAdmin ?? false);

    this.assertNoRepeats(input.questionIds);

    const questions: Awaited<ReturnType<PaperService['requireDrawable']>>[] = [];
    for (const questionId of input.questionIds) {
      const question = await this.requireDrawable(questionId, section.id);
      await this.assertNotAlreadyOnThePaper(testId, question.id);
      questions.push(question);
    }

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      select: {
        order: true,
        baseConfigSectionId: true,
        question: { select: { difficulty: true } },
      },
    });
    const inSection = rows.filter((row) => row.baseConfigSectionId === section.id);
    if (inSection.length + questions.length > section.questionCount) {
      const full = `${section.name} already holds the ${section.questionCount} it needs. Take one off first.`;
      throw new AppException(ErrorCodes.CONFLICT, full, { fieldErrors: { questionIds: [full] } });
    }

    const quota = sectionQuota(
      mixOf(test.questionPoolFilter as DrawSpec | null, section.id),
      inSection.map((row) => row.question.difficulty),
    );
    assertWithinSplit(
      section.name,
      quotaWithPicks(
        quota,
        questions.map((question) => question.difficulty),
      ),
      'questionIds',
    );

    const highest = rows.reduce((max, row) => Math.max(max, row.order), 0);
    await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      await tx.paperQuestion.createMany({
        data: questions.map((question, index) => ({
          testId,
          baseConfigId: test.baseConfigId,
          baseConfigSectionId: section.id,
          questionId: question.id,
          questionVersionId: question.currentVersionId,
          order: highest + index + 1,
          marks: section.marksPerQuestion,
          negativeMarks: section.negativeMarks,
        })),
      });
    });

    return this.paperOf(testId, this.scopedOf(test, config));
  }

  /** Tops a hand-picked section up to its count from its own spec: the draw only ever ADDS. */
  async fillSection(
    testId: string,
    baseConfigSectionId: string,
    editor: Editor = {},
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    await takeTestEditLock(this.redis, this.prisma, testId, editor);
    this.assertAssemblable(test);
    assertSourceChosen(test);

    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find((row) => row.id === baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);
    await this.assertSectionsNotAssigned(testId, [section.id], editor.isSuperAdmin ?? false);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      select: HELD_SELECT,
    });
    const spec = (test.questionPoolFilter as DrawSpec | null)?.sections?.[section.id];
    const added = await this.drawRemainder(section, spec, rows);
    if (added.length === 0) return this.paperOf(testId, this.scopedOf(test, config));

    const highest = rows.reduce((max, row) => Math.max(max, row.order), 0);
    await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      await tx.paperQuestion.createMany({
        data: added.map((row, index) => ({
          ...row,
          testId,
          baseConfigId: test.baseConfigId,
          // The engine numbers what it drew from 1, knowing nothing of the rows already here.
          order: highest + index + 1,
        })),
      });
    });

    return this.paperOf(testId, this.scopedOf(test, config));
  }

  /** What the section still lacks. The engine hands the pins back, so only the new rows survive. */
  private async drawRemainder(
    section: BaseConfigDetail['sections'][number],
    spec: SectionDrawSpec | undefined,
    rows: readonly HeldRow[],
  ): Promise<DrawnQuestion[]> {
    const held = rows.filter((row) => row.baseConfigSectionId === section.id);
    // One question sits on a paper once, so every row already on it is out of this draw's reach.
    const onPaper = new Set(rows.map((row) => row.questionId));
    const pool = (await this.poolFor(section, spec)).filter(
      (candidate) => !onPaper.has(candidate.id),
    );

    const pins = await this.pinsOf(held);
    // Judged on the pins alone, so what the bank happens to stock cannot change the verdict.
    assertWithinSplit(
      section.name,
      sectionQuota(
        spec?.mix,
        pins.map((pin) => pin.difficulty),
      ),
      FORM_LEVEL_FIELD,
    );

    const result = drawSection({ section, pool, spec, seed: freshSeed(), pins });
    if (!result.ok) {
      const { baseConfigSectionId, sectionName, needed, available } = result.shortfall;
      throw new AppException(ErrorCodes.DRAW_SHORTFALL, SECTION_TOO_THIN_MESSAGE, {
        fieldErrors: {
          [baseConfigSectionId]: [
            `${sectionName} needs ${needed}, and the bank holds ${available}.`,
          ],
        },
      });
    }

    return result.questions.filter((row) => !onPaper.has(row.questionId));
  }

  /** The section's own rows as the draw reads them, pinned so the fill can only add around them. */
  private async pinsOf(held: readonly HeldRow[]): Promise<DrawCandidate[]> {
    if (held.length === 0) return [];
    const rows = await this.prisma.question.findMany({
      where: { id: { in: held.map((row) => row.questionId) } },
      select: CANDIDATE_SELECT,
    });
    const bank = new Map(rows.map((row) => [row.id, row]));

    return held.flatMap((row) => {
      const question = bank.get(row.questionId);
      // The version the ROW pins, so a question the bank has moved on from still counts as one.
      return question ? [{ ...question, currentVersionId: row.questionVersionId }] : [];
    });
  }

  /** One row swapped for another question, keeping its place in the paper. */
  async replaceQuestion(
    testId: string,
    rowId: string,
    input: ReplacePaperQuestionBody,
    editor: Editor = {},
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    await takeTestEditLock(this.redis, this.prisma, testId, editor);
    this.assertAssemblable(test);
    assertSourceChosen(test);

    const row = await this.requireRow(testId, rowId);
    await this.assertSectionsNotAssigned(
      testId,
      [row.baseConfigSectionId],
      editor.isSuperAdmin ?? false,
    );
    const question = await this.requireDrawable(input.questionId, row.baseConfigSectionId);
    await this.assertNotAlreadyOnThePaper(testId, question.id, rowId);

    await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      await tx.paperQuestion.update({
        where: { id: rowId },
        data: { questionId: question.id, questionVersionId: question.currentVersionId },
      });
    });

    return this.paperOf(testId, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  /** Dropped, leaving its section short of the count its config asks for until one is drawn. */
  async removeQuestions(
    testId: string,
    rowIds: readonly string[],
    editor: Editor = {},
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    await takeTestEditLock(this.redis, this.prisma, testId, editor);
    this.assertAssemblable(test);

    // Every row resolved before any is deleted: a half-removed batch is one nobody can reason about.
    const rows = [];
    for (const rowId of rowIds) rows.push(await this.requireRow(testId, rowId));
    await this.assertSectionsNotAssigned(
      testId,
      [...new Set(rows.map((row) => row.baseConfigSectionId))],
      editor.isSuperAdmin ?? false,
    );

    await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      await tx.paperQuestion.deleteMany({ where: { testId, id: { in: [...rowIds] } } });
    });

    return this.paperOf(testId, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  /** The only change an OFFERED paper allows; before that a question is edited, never withdrawn. */
  async setQuestionStatus(
    testId: string,
    rowId: string,
    { status, reason }: SetPaperQuestionStatusBody,
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    if (test.finalizedAt === null) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_FROZEN_MESSAGE);
    }
    const row = await this.requireRow(testId, rowId);

    const asked = await this.prisma.$transaction(async (tx) => {
      // The gate is the WRITE, not a read before it: two admins clicking cannot both win.
      const moved = await tx.paperQuestion.updateMany({
        where: { testId, questionId: row.questionId, status: { not: status } },
        data: { status },
      });
      if (moved.count === 0) return null;
      return {
        rows: moved.count,
        sittings: await this.outbox.rescore(tx, testId),
      };
    });

    // Only on a real change, and against the ROW: "test updated" cannot settle a dispute later.
    if (asked) {
      this.auditContext.setEntityId(rowId);
      this.auditContext.setChanged({
        status: { from: row.status, to: status },
        reason: { from: null, to: reason },
      });
      this.logger.log(
        `Question ${row.questionId} on test ${testId} is ${status} across ${asked.rows} paper rows; ${asked.sittings} sittings to re-score`,
      );
    }
    return this.paperOf(testId, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  private async requireRow(testId: string, rowId: string) {
    const row = await this.prisma.paperQuestion.findUnique({
      where: { id: rowId },
      select: {
        id: true,
        testId: true,
        baseConfigSectionId: true,
        questionId: true,
        status: true,
      },
    });
    if (row?.testId !== testId) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That question is not on this paper');
    }
    return row;
  }

  /** The replacement has to be drawable for the same section, or the paper stops matching itself. */
  private async requireDrawable(questionId: string, baseConfigSectionId: string) {
    const section = await this.prisma.baseConfigSection.findUnique({
      where: { id: baseConfigSectionId },
      select: { subjectId: true },
    });
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        status: true,
        subjectId: true,
        currentVersionId: true,
        difficulty: true,
      },
    });

    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    if (question.status === QUESTION_STATUS.ARCHIVED || !question.currentVersionId) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, NOT_DRAWABLE_MESSAGE, {
        fieldErrors: { questionId: [NOT_DRAWABLE_MESSAGE] },
      });
    }
    if (section?.subjectId && question.subjectId !== section.subjectId) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, WRONG_SUBJECT_MESSAGE, {
        fieldErrors: { questionId: [WRONG_SUBJECT_MESSAGE] },
      });
    }
    return { ...question, currentVersionId: question.currentVersionId };
  }

  /** `@@unique([testId, questionId])` would refuse it, and a constraint error is not a message. */
  private async assertNotAlreadyOnThePaper(
    testId: string,
    questionId: string,
    // The row being replaced, which holds this question already and is not in its own way.
    exceptRowId?: string,
  ): Promise<void> {
    const held = await this.prisma.paperQuestion.findFirst({
      where: { testId, questionId, ...(exceptRowId ? { id: { not: exceptRowId } } : {}) },
      select: { id: true },
    });
    if (held) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, ALREADY_ON_THE_PAPER_MESSAGE, {
        fieldErrors: { questionId: [ALREADY_ON_THE_PAPER_MESSAGE] },
      });
    }
  }

  /** The same unique constraint the paper itself carries, checked before a batch ever reaches it. */
  private assertNoRepeats(questionIds: readonly string[]): void {
    if (new Set(questionIds).size === questionIds.length) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, ALREADY_ON_THE_PAPER_MESSAGE, {
      fieldErrors: { questionIds: [ALREADY_ON_THE_PAPER_MESSAGE] },
    });
  }

  /** Anything not archived, unflagged and carrying a current version: a paper pins a version, so there must be one. */
  private async poolFor(
    section: DrawSection,
    spec: SectionDrawSpec | undefined,
  ): Promise<DrawCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        ...DRAWABLE_QUESTION,
        // The narrowing SQL can do; tags and the split are the engine's.
        ...(section.subjectId === null ? {} : { subjectId: section.subjectId }),
        ...(narrows(spec?.topicIds) ? { topicId: { in: [...spec.topicIds] } } : {}),
      },
      select: CANDIDATE_SELECT,
    });
    return rows.filter(hasVersion);
  }

  /** A section is its TYPIST's until they are done — nobody but a super admin fills it underneath. */
  private async assertSectionsNotAssigned(
    testId: string,
    baseConfigSectionIds: readonly string[],
    isSuperAdmin: boolean,
  ): Promise<void> {
    if (isSuperAdmin) return;

    const outstanding = await this.prisma.questionAssignment.findMany({
      where: {
        testId,
        // A reader reads what is already there, so only an outstanding typist holds the section.
        role: ASSIGNMENT_ROLES.TYPIST,
        finalizedAt: null,
        baseConfigSectionId: { in: [...baseConfigSectionIds] },
      },
      select: {
        baseConfigSection: { select: { name: true } },
        assignee: { select: { fullName: true } },
      },
    });
    if (outstanding.length === 0) return;

    const issues = outstanding.map(
      (row) =>
        `${row.baseConfigSection.name} is with ${row.assignee.fullName ?? 'its assignee'} until they mark it done.`,
    );
    const [first] = issues;
    throw new AppException(ErrorCodes.CONFLICT, first ?? '', {
      fieldErrors: { [FORM_LEVEL_FIELD]: issues },
    });
  }

  /** A paper stops moving when it is offered, and stops for good once somebody has sat it. */
  private assertAssemblable(test: {
    finalizedAt: Date | null;
    _count: { attempts: number };
  }): void {
    if (test._count.attempts === 0 && test.finalizedAt === null) return;
    const refusal = test._count.attempts > 0 ? SAT_TEST_MESSAGE : OFFERED_TEST_MESSAGE;
    throw new AppException(ErrorCodes.CONFLICT, refusal, {
      fieldErrors: { [FORM_LEVEL_FIELD]: [refusal] },
    });
  }

  private async paperOf(
    testId: string,
    sections: BaseConfigDetail['sections'],
  ): Promise<TestPaper> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      include: PAPER_INCLUDE,
      orderBy: { order: 'asc' },
    });

    return {
      testId,
      totalQuestions: rows.length,
      sections: sections.map((section) => ({
        baseConfigSectionId: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        questions: rows
          .filter((row) => row.baseConfigSectionId === section.id)
          .map((row) => ({
            id: row.id,
            testId: row.testId,
            baseConfigId: row.baseConfigId,
            baseConfigSectionId: row.baseConfigSectionId,
            questionId: row.questionId,
            questionVersionId: row.questionVersionId,
            order: row.order,
            marks: Number(row.marks),
            negativeMarks: Number(row.negativeMarks),
            status: row.status,
            question: {
              id: row.question.id,
              questionCode: row.question.questionCode,
              difficulty: row.question.difficulty,
              subjectId: row.question.subjectId,
              topicId: row.question.topicId,
              stemPreview: stemPreviewOf(
                (row.question.currentVersion?.content as LocalizedContent | undefined) ?? {},
              ),
            },
          })),
      })),
    };
  }

  /** The sections this test's scope covers. Building, drawing, reading and counting use these alone. */
  private scopedOf(
    test: { scope: TestScope; scopeRef: Prisma.JsonValue },
    config: BaseConfigDetail,
  ): BaseConfigDetail['sections'] {
    const scopeRef = (test.scopeRef as TestScopeRef | null) ?? null;
    return [...scopedSections(config.sections, test.scope, scopeRef)];
  }

  private async requireTest(id: string) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: {
        id: true,
        baseConfigId: true,
        finalizedAt: true,
        paperSource: true,
        scope: true,
        scopeRef: true,
        questionPoolFilter: true,
        _count: { select: { attempts: true } },
      },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}

/** Picking IS choosing where questions come from, so it waits on the decision — a super admin makes it, not skips it. */
function assertSourceChosen(test: { paperSource: PaperSource | null }): void {
  if (test.paperSource !== null) return;
  throw new AppException(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE, {
    fieldErrors: { [FORM_LEVEL_FIELD]: [SOURCE_UNCHOSEN_MESSAGE] },
  });
}

function hasVersion(row: CandidateRow): row is CandidateRow & { currentVersionId: string } {
  return row.currentVersionId !== null;
}

function mixOf(spec: DrawSpec | null, sectionId: string): DifficultyMix | undefined {
  return spec?.sections?.[sectionId]?.mix;
}

/** The split bounds hand-picking as much as it does the draw, so one bucket over it is refused. */
function assertWithinSplit(sectionName: string, quota: SectionQuota, field: string): void {
  const over = DIFFICULTY_LEVELS.some((level) => {
    const { chosen, allowed } = quota[level];
    return allowed !== null && chosen > allowed;
  });
  if (!over) return;

  const message = overSplitMessage(sectionName);
  throw new AppException(ErrorCodes.CONFLICT, message, { fieldErrors: { [field]: [message] } });
}

const SEED_CEILING = 2 ** 31;

/** A re-draw the admin did not seed should give a different paper — that is what re-draw means. */
function freshSeed(): number {
  return randomInt(SEED_CEILING);
}
