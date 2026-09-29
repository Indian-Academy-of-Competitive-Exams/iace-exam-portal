import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Question } from '@prisma/client';
import {
  AppException,
  ASSIGNMENT_ROLES,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_SOURCES,
  type BaseConfigDetail,
  quotaWithPicks,
  sectionQuota,
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
  type TypistDoneBody,
  scopedSections,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
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
import { beginDraftPaperEdit, beginPaperEdit } from './begin-paper-edit';
import { takeTestEditLock, type Editor } from './edit-lock';
import { drawableFor, QuestionsService, stemPreviewOf } from '../questions';
import { doneOpen, reopenReadingIfUnchecked } from '../assignments';
import { AuditContext } from '../audit';
import { formRefusal } from '../common/form-refusal';

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
const SECTION_UNDER_TYPED_MESSAGE =
  'Its typist has not written enough questions to fill the rest of this section yet.';
const TYPED_SECTION_MESSAGE =
  "A typed section's paper is what its typist chose at Done. Send the section back to change it.";
const ALREADY_DONE_MESSAGE = 'This section is already marked done.';
const HANDED_AT_DONE_MESSAGE = "A typed section reaches its proof-reader at its typist's Done.";
const HANDED_AT_HAND_OVER_MESSAGE =
  'A picked section reaches its proof-reader when its owner hands it over, not at a Done.';
const NO_READER_MESSAGE = 'Give this section a proof-reader before handing it over.';
const ALREADY_HANDED_MESSAGE = 'This section is already with its proof-reader.';
const NOT_WRITTEN_HERE_MESSAGE = 'Choose only questions written for this section.';

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
    private readonly auditContext: AuditContext,
    private readonly redis: RedisService,
    private readonly questions: QuestionsService,
  ) {}

  async read(testId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    const config = await this.configs.detail(test.baseConfigId);
    return this.paperOf(test, this.scopedOf(test, config));
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
    this.assertNotTyped(test, editor);
    await this.assertWithOwner(testId, [section.id], editor);

    this.assertNoRepeats(input.questionIds);

    // Four reads for the whole request, not four a question: the checks below are all set lookups.
    const drawable = await this.drawableContext(testId, input.questionIds, section.id);
    const onPaper = new Set(
      (
        await this.prisma.paperQuestion.findMany({
          where: { testId, questionId: { in: input.questionIds } },
          select: { questionId: true },
        })
      ).map((row) => row.questionId),
    );

    const questions = input.questionIds.map((questionId) => {
      const question = assertDrawableIn(drawable, questionId);
      if (onPaper.has(questionId)) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, ALREADY_ON_THE_PAPER_MESSAGE, {
          fieldErrors: { questionId: [ALREADY_ON_THE_PAPER_MESSAGE] },
        });
      }
      return question;
    });

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
      (test.questionPoolFilter as DrawSpec | null)?.sections?.[section.id]?.mix,
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
      await beginDraftPaperEdit(tx, testId);
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
      await reopenReadingIfUnchecked(tx, testId, section.id);
    }, TX_LIMITS.SHORT);

    return this.paperOf(test, this.scopedOf(test, config));
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
    this.assertNotTyped(test, editor);
    await this.assertWithOwner(testId, [section.id], editor);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      select: HELD_SELECT,
    });
    const spec = (test.questionPoolFilter as DrawSpec | null)?.sections?.[section.id];
    const added = await this.drawRemainder(testId, section, spec, rows, test.paperSource);
    if (added.length === 0) return this.paperOf(test, this.scopedOf(test, config));

    const highest = rows.reduce((max, row) => Math.max(max, row.order), 0);
    await this.prisma.$transaction(async (tx) => {
      await beginDraftPaperEdit(tx, testId);
      await tx.paperQuestion.createMany({
        data: added.map((row, index) => ({
          ...row,
          testId,
          baseConfigId: test.baseConfigId,
          // The engine numbers what it drew from 1, knowing nothing of the rows already here.
          order: highest + index + 1,
        })),
      });
      await reopenReadingIfUnchecked(tx, testId, section.id);
    }, TX_LIMITS.SHORT);

    return this.paperOf(test, this.scopedOf(test, config));
  }

  /** What the section still lacks. The engine hands the pins back, so only the new rows survive. */
  private async drawRemainder(
    testId: string,
    section: BaseConfigDetail['sections'][number],
    spec: SectionDrawSpec | undefined,
    rows: readonly HeldRow[],
    source: PaperSource | null,
  ): Promise<DrawnQuestion[]> {
    const held = rows.filter((row) => row.baseConfigSectionId === section.id);
    // One question sits on a paper once, so every row already on it is out of this draw's reach.
    const onPaper = new Set(rows.map((row) => row.questionId));
    const pool = (await this.poolFor(testId, section, spec, source)).filter(
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
      const framed = source === PAPER_SOURCES.FRAMED;
      const held = framed ? 'its typist has written' : 'the bank holds';
      throw new AppException(
        ErrorCodes.DRAW_SHORTFALL,
        framed ? SECTION_UNDER_TYPED_MESSAGE : SECTION_TOO_THIN_MESSAGE,
        {
          fieldErrors: {
            [baseConfigSectionId]: [`${sectionName} needs ${needed}, and ${held} ${available}.`],
          },
        },
      );
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
    this.assertNotTyped(test, editor);
    await this.assertWithOwner(testId, [row.baseConfigSectionId], editor);
    const question = await this.requireDrawable(testId, input.questionId, row.baseConfigSectionId);
    await this.assertNotAlreadyOnThePaper(testId, question.id, rowId);

    await this.prisma.$transaction(async (tx) => {
      await beginDraftPaperEdit(tx, testId);
      await tx.paperQuestion.update({
        where: { id: rowId },
        data: { questionId: question.id, questionVersionId: question.currentVersionId },
      });
      await reopenReadingIfUnchecked(tx, testId, row.baseConfigSectionId);
    }, TX_LIMITS.SHORT);

    return this.paperOf(test, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  /** A typist's one hand-over: exactly the section's count, inside its mix, becomes its paper. */
  async typistDone(assignmentId: string, body: TypistDoneBody): Promise<void> {
    const typing = await this.prisma.questionAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        role: true,
        finalizedAt: true,
        replacedAt: true,
        testId: true,
        baseConfigSectionId: true,
      },
    });
    if (typing?.role !== ASSIGNMENT_ROLES.TYPIST || typing.replacedAt) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    }
    if (typing.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, ALREADY_DONE_MESSAGE);

    const { testId } = typing;
    this.auditContext.setEntityId(testId);
    const test = await this.requireTest(testId);
    this.assertAssemblable(test);
    if (!doneOpen({ ...typing, test })) {
      throw new AppException(ErrorCodes.CONFLICT, HANDED_AT_HAND_OVER_MESSAGE);
    }
    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find(
      (row) => row.id === typing.baseConfigSectionId,
    );
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);

    const pair = { testId, baseConfigSectionId: section.id };
    const typed = (await this.typedFor(pair)).map((question) => question.id);
    const selected = await this.assertTypedSelection(testId, typed, section, body, test);
    const chosen = new Set([...body.selected, ...body.discard]);

    await this.prisma.$transaction(async (tx) => {
      await beginDraftPaperEdit(tx, testId);
      const done = await tx.questionAssignment.updateMany({
        where: { id: assignmentId, finalizedAt: null },
        data: { finalizedAt: new Date() },
      });
      if (done.count === 0) throw new AppException(ErrorCodes.CONFLICT, ALREADY_DONE_MESSAGE);
      await this.placeTyped(tx, test, section, selected);
      // The same fact from the reader's side: the section has reached them.
      await tx.questionAssignment.updateMany({
        where: { ...pair, ...ACTIVE_READER, handedAt: null },
        data: { handedAt: new Date() },
      });
      // After the paper lets go of them: a question still on it cannot be deleted.
      await this.questions.settleTyped(
        tx,
        body.discard,
        typed.filter((id) => !chosen.has(id)),
      );
    }, TX_LIMITS.SHORT);
  }

  /** The section's rows become exactly the choice: unticked rows go, new ones join after the highest. */
  private async placeTyped(
    tx: Prisma.TransactionClient,
    { id: testId, baseConfigId }: { id: string; baseConfigId: string },
    section: BaseConfigDetail['sections'][number],
    selected: readonly (DrawableQuestion & { currentVersionId: string })[],
  ): Promise<void> {
    const chosen = new Set(selected.map((question) => question.id));
    const held = await tx.paperQuestion.findMany({
      where: { testId, baseConfigSectionId: section.id },
      select: { id: true, questionId: true },
    });
    await tx.paperQuestion.deleteMany({
      where: { id: { in: held.filter((row) => !chosen.has(row.questionId)).map((row) => row.id) } },
    });

    const kept = new Set(held.map((row) => row.questionId));
    const highest = await tx.paperQuestion.aggregate({ where: { testId }, _max: { order: true } });
    await tx.paperQuestion.createMany({
      data: selected
        .filter((question) => !kept.has(question.id))
        .map((question, index) => ({
          testId,
          baseConfigId,
          baseConfigSectionId: section.id,
          questionId: question.id,
          questionVersionId: question.currentVersionId,
          order: (highest._max.order ?? 0) + index + 1,
          marks: section.marksPerQuestion,
          negativeMarks: section.negativeMarks,
        })),
    });
  }

  /** Every refusal before any write: the choice is the typist's own, whole, drawable and inside the mix. */
  private async assertTypedSelection(
    testId: string,
    typed: readonly string[],
    section: BaseConfigDetail['sections'][number],
    { selected, discard }: TypistDoneBody,
    test: { questionPoolFilter: Prisma.JsonValue },
  ): Promise<(DrawableQuestion & { currentVersionId: string })[]> {
    this.assertNoRepeats(selected);
    if (selected.length !== section.questionCount) {
      throw selectionRefused(
        `${section.name} needs exactly ${section.questionCount} questions; ${selected.length} are chosen.`,
      );
    }

    const own = new Set(typed);
    const stray = [...selected, ...discard].some((id) => !own.has(id));
    if (stray || discard.some((id) => selected.includes(id))) {
      throw selectionRefused(NOT_WRITTEN_HERE_MESSAGE);
    }

    const drawable = await this.drawableContext(testId, selected, section.id);
    const questions = selected.map((id) => assertDrawableIn(drawable, id));
    const mix = (test.questionPoolFilter as DrawSpec | null)?.sections?.[section.id]?.mix;
    const quota = sectionQuota(
      mix,
      questions.map((question) => question.difficulty),
    );
    const off = DIFFICULTY_LEVELS.filter((level) => {
      const { chosen, allowed } = quota[level];
      return allowed !== null && chosen !== allowed;
    });
    if (off.length > 0) {
      const counts = off.map(
        (level) => `${DIFFICULTY_LABELS[level]} ${quota[level].chosen} of ${quota[level].allowed}`,
      );
      throw selectionRefused(`${section.name} needs its difficulty split: ${counts.join(', ')}.`);
    }
    return questions;
  }

  /** Whatever any typist of the section wrote for it: the role's work, not one person's. */
  private typedFor(pair: { testId: string; baseConfigSectionId: string }) {
    return this.prisma.question.findMany({
      where: { assignment: { ...pair, role: ASSIGNMENT_ROLES.TYPIST } },
      select: { id: true },
    });
  }

  /** A picked section, full, handed to its proof-reader: from here it is theirs to review. */
  async handOver(
    testId: string,
    baseConfigSectionId: string,
    editor: Editor = {},
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    await takeTestEditLock(this.redis, this.prisma, testId, editor);
    this.assertAssemblable(test);
    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find((row) => row.id === baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);

    const pair = { testId, baseConfigSectionId };
    const [held, reader] = await Promise.all([
      this.prisma.paperQuestion.count({ where: pair }),
      this.prisma.questionAssignment.findFirst({
        where: { ...pair, ...ACTIVE_READER },
        select: { handedAt: true },
      }),
    ]);
    const gap = handOverGap(test, section, held, reader);
    if (gap) throw formRefusal(ErrorCodes.CONFLICT, gap);
    const handed = await this.prisma.questionAssignment.updateMany({
      where: { ...pair, ...ACTIVE_READER, handedAt: null },
      data: { handedAt: new Date() },
    });
    if (handed.count === 0) throw formRefusal(ErrorCodes.CONFLICT, ALREADY_HANDED_MESSAGE);
    return this.paperOf(test, this.scopedOf(test, config));
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
    const sectionIds = new Set<string>();
    for (const rowId of rowIds)
      sectionIds.add((await this.requireRow(testId, rowId)).baseConfigSectionId);
    this.assertNotTyped(test, editor);
    await this.assertWithOwner(testId, [...sectionIds], editor);

    await this.prisma.$transaction(async (tx) => {
      await beginDraftPaperEdit(tx, testId);
      await tx.paperQuestion.deleteMany({ where: { testId, id: { in: [...rowIds] } } });
    }, TX_LIMITS.SHORT);

    return this.paperOf(test, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
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

    const moved = await this.prisma.$transaction(async (tx) => {
      // Test before Question: the guard's status-only fast path skips the lock this needs below.
      await beginPaperEdit(tx, testId);
      // The gate is the WRITE, not a read before it: two admins clicking cannot both win.
      const rows = await tx.paperQuestion.updateMany({
        where: { testId, questionId: row.questionId, status: { not: status } },
        data: { status },
      });
      if (rows.count === 0) return 0;
      // The whole re-score: every sitting marked against an older revision is found by the sweeper.
      await tx.test.update({ where: { id: testId }, data: { paperRevision: { increment: 1 } } });
      return rows.count;
    }, TX_LIMITS.SHORT);

    // Only on a real change, and against the ROW: "test updated" cannot settle a dispute later.
    if (moved > 0) {
      this.auditContext.setEntityId(rowId);
      this.auditContext.setChanged({
        status: { from: row.status, to: status },
        reason: { from: null, to: reason },
      });
      this.logger.log(
        `Question ${row.questionId} on test ${testId} is ${status} across ${moved} paper rows; its sittings are re-scored by the sweep`,
      );
    }
    return this.paperOf(test, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
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
  private async requireDrawable(testId: string, questionId: string, baseConfigSectionId: string) {
    return assertDrawableIn(
      await this.drawableContext(testId, [questionId], baseConfigSectionId),
      questionId,
    );
  }

  /** What drawability turns on, read once for however many questions are being asked about. */
  private async drawableContext(
    testId: string,
    questionIds: readonly string[],
    baseConfigSectionId: string,
  ): Promise<DrawableContext> {
    const ids = [...questionIds];
    const [section, questions, drawable] = await Promise.all([
      this.prisma.baseConfigSection.findUnique({
        where: { id: baseConfigSectionId },
        select: { subjectId: true },
      }),
      this.prisma.question.findMany({
        where: { id: { in: ids } },
        select: { id: true, subjectId: true, currentVersionId: true, difficulty: true },
      }),
      // Asked of the database, not of the row: drawability turns on other rows as well as this one.
      this.prisma.question.findMany({
        where: { id: { in: ids }, ...drawableFor(testId) },
        select: { id: true },
      }),
    ]);

    return {
      sectionSubjectId: section?.subjectId ?? null,
      byId: new Map(questions.map((question) => [question.id, question])),
      drawable: new Set(drawable.map((row) => row.id)),
    };
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
    testId: string,
    section: DrawSection,
    spec: SectionDrawSpec | undefined,
    source: PaperSource | null,
  ): Promise<DrawCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        ...drawableFor(testId),
        ...(source === PAPER_SOURCES.FRAMED
          ? // A framed section is made of what its own typist wrote, never of what the bank happens to hold.
            { assignment: { testId, baseConfigSectionId: section.id } }
          : {
              // The narrowing SQL can do; tags and the split are the engine's.
              ...(section.subjectId === null ? {} : { subjectId: section.subjectId }),
              ...(narrows(spec?.topicIds) ? { topicId: { in: [...spec.topicIds] } } : {}),
            }),
      },
      select: CANDIDATE_SELECT,
    });
    return rows.filter(hasVersion);
  }

  /** Handed to its reader and not yet released, a section's paper is theirs to read, not the owner's to move. */
  private async assertWithOwner(
    testId: string,
    baseConfigSectionIds: readonly string[],
    editor: Editor,
  ): Promise<void> {
    if (editor.isSuperAdmin) return;
    const reading = await this.prisma.questionAssignment.findFirst({
      where: {
        testId,
        baseConfigSectionId: { in: [...baseConfigSectionIds] },
        role: ASSIGNMENT_ROLES.PROOFREADER,
        replacedAt: null,
        handedAt: { not: null },
        finalizedAt: null,
      },
      select: { baseConfigSection: { select: { name: true } } },
    });
    if (!reading) return;
    const issue = `${reading.baseConfigSection.name} is with its proof-reader until they release it.`;
    throw formRefusal(ErrorCodes.CONFLICT, issue);
  }

  /** A typed section is placed by its typist's Done and changed only by its reader's send-back. */
  private assertNotTyped(test: { paperSource: PaperSource | null }, editor: Editor): void {
    if (test.paperSource !== PAPER_SOURCES.FRAMED || editor.isSuperAdmin) return;
    throw formRefusal(ErrorCodes.CONFLICT, TYPED_SECTION_MESSAGE);
  }

  /** A paper stops moving when it is offered, and stops for good once somebody has sat it. */
  private assertAssemblable(test: {
    finalizedAt: Date | null;
    _count: { attempts: number };
  }): void {
    if (test._count.attempts === 0 && test.finalizedAt === null) return;
    const refusal = test._count.attempts > 0 ? SAT_TEST_MESSAGE : OFFERED_TEST_MESSAGE;
    throw formRefusal(ErrorCodes.CONFLICT, refusal);
  }

  private async paperOf(
    test: HandOverTest & { id: string },
    sections: BaseConfigDetail['sections'],
  ): Promise<TestPaper> {
    const [rows, readers] = await Promise.all([
      this.prisma.paperQuestion.findMany({
        where: { testId: test.id },
        include: PAPER_INCLUDE,
        orderBy: { order: 'asc' },
      }),
      this.prisma.questionAssignment.findMany({
        where: { testId: test.id, ...ACTIVE_READER },
        select: { baseConfigSectionId: true, handedAt: true },
      }),
    ]);
    const readerOf = new Map(readers.map((reader) => [reader.baseConfigSectionId, reader]));

    return {
      testId: test.id,
      totalQuestions: rows.length,
      sections: sections.map((section) => {
        const held = rows.filter((row) => row.baseConfigSectionId === section.id);
        const reader = readerOf.get(section.id) ?? null;
        return {
          baseConfigSectionId: section.id,
          name: section.name,
          order: section.order,
          questionCount: section.questionCount,
          canHandOver: handOverGap(test, section, held.length, reader) === null,
          questions: held.map((row) => ({
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
        };
      }),
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

/** The reader a paper's hand-over and Done reach: whoever holds the reading now. */
const ACTIVE_READER = { role: ASSIGNMENT_ROLES.PROOFREADER, replacedAt: null } as const;

type HandOverTest = { paperSource: PaperSource | null; finalizedAt: Date | null };

/** Why a picked section cannot reach its reader now, or null once it can — the hand-over and the paper's flag read this. */
function handOverGap(
  test: HandOverTest,
  section: { name: string; questionCount: number },
  held: number,
  reader: { handedAt: Date | null } | null,
): string | null {
  if (test.finalizedAt) return OFFERED_TEST_MESSAGE;
  if (test.paperSource !== PAPER_SOURCES.PICKED) return HANDED_AT_DONE_MESSAGE;
  if (held < section.questionCount) {
    return `${section.name} holds ${held} of its ${section.questionCount} questions. Fill it before handing it over.`;
  }
  if (!reader) return NO_READER_MESSAGE;
  if (reader.handedAt) return ALREADY_HANDED_MESSAGE;
  return null;
}

/** Picking IS choosing where questions come from, so it waits on the decision — a super admin makes it, not skips it. */
function assertSourceChosen(test: { paperSource: PaperSource | null }): void {
  if (test.paperSource !== null) return;
  throw formRefusal(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE);
}

function hasVersion(row: CandidateRow): row is CandidateRow & { currentVersionId: string } {
  return row.currentVersionId !== null;
}

/** The split bounds hand-picking as much as it does the draw, so one bucket over it is refused. */
function assertWithinSplit(sectionName: string, quota: SectionQuota, field: string): void {
  const over = DIFFICULTY_LEVELS.some((level) => {
    const { chosen, allowed } = quota[level];
    return allowed !== null && chosen > allowed;
  });
  if (!over) return;

  const message = `${sectionName} already holds more of one difficulty than its split allows. Take one off first.`;
  throw new AppException(ErrorCodes.CONFLICT, message, { fieldErrors: { [field]: [message] } });
}

const SEED_CEILING = 2 ** 31;

/** A re-draw the admin did not seed should give a different paper — that is what re-draw means. */
function freshSeed(): number {
  return randomInt(SEED_CEILING);
}

const selectionRefused = (issue: string) =>
  new AppException(ErrorCodes.VALIDATION_ERROR, issue, { fieldErrors: { selected: [issue] } });

/** Every question the request named, with what its drawability turns on, read once. */
interface DrawableContext {
  sectionSubjectId: string | null;
  byId: Map<string, DrawableQuestion>;
  drawable: Set<string>;
}

interface DrawableQuestion {
  id: string;
  subjectId: string;
  currentVersionId: string | null;
  difficulty: Question['difficulty'];
}

/** The three refusals in the order a caller meets them, off the context rather than the database. */
function assertDrawableIn(
  context: DrawableContext,
  questionId: string,
): DrawableQuestion & { currentVersionId: string } {
  const question = context.byId.get(questionId);
  if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');

  if (!context.drawable.has(questionId) || !question.currentVersionId) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, NOT_DRAWABLE_MESSAGE, {
      fieldErrors: { questionId: [NOT_DRAWABLE_MESSAGE] },
    });
  }
  if (context.sectionSubjectId && question.subjectId !== context.sectionSubjectId) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, WRONG_SUBJECT_MESSAGE, {
      fieldErrors: { questionId: [WRONG_SUBJECT_MESSAGE] },
    });
  }
  return { ...question, currentVersionId: question.currentVersionId };
}
