import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  SECTION_SEATS,
  can,
  type Assignment,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionOnOtherTest,
  type QuestionTime,
  type SectionQuestion,
  type SectionSeat,
  type SectionWork,
  type SendBackBody,
  type WorkTimeTotal,
  type TypingPresetKey,
  sectionAnswerKindOf,
  sectionLanguagesFor,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { assertSourceChosen, beginDraftPaperEdit } from '../common/paper-edit';
import { RedisService } from '../redis/redis.service';
import { releaseSectionEditLock, sectionEditingBy, takeSectionEditLock } from '../common/edit-lock';
import {
  AssignmentsService,
  assertJobOpen,
  jobOpen,
  reopenReadingIfUnchecked,
} from '../assignments';
import { QuestionImportService } from './question-import.service';
import { QuestionsService } from './questions.service';
import {
  SectionViewer,
  type Pair,
  type Context,
  type ScopedQuestion,
  NOT_YOURS,
  OFFERED_MESSAGE,
  NOT_EDITABLE_MESSAGE,
  NOT_DELETABLE_MESSAGE,
  READERS_ONLY_MESSAGE,
  NOT_HANDED_MESSAGE,
  RELEASED_MESSAGE,
  WITH_TYPIST_MESSAGE,
  NO_TYPIST_MESSAGE,
  NOT_SENT_BACK_MESSAGE,
  TYPISTS_ONLY_MESSAGE,
  SEATS_ONLY_MESSAGE,
  isOpenSendBack,
  assertTypeFits,
  editable,
  deletable,
  reviewRow,
  seesEverySeat,
  noTime,
  actingAs,
  typingRow,
  heldNow,
} from './section-rules';
import { scopedQuestions } from './section-scoped';
import { otherTestsOf } from './section-other-tests';

/** One section of one test as whoever holds it works on it — the same facts for all, the rules per seat. */
@Injectable()
export class SectionWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly questions: QuestionsService,
    private readonly assignments: AssignmentsService,
    private readonly imports: QuestionImportService,
  ) {}

  async one(pair: Pair, viewer: SectionViewer): Promise<SectionWork> {
    return this.workOf(await this.load(pair, viewer));
  }

  /** A review write changes nothing `load` read, so an action answers from the context it checked. */
  private async workOf(context: Context): Promise<SectionWork> {
    const { pair } = context;
    const [scoped, editingBy, canRelease, times, sitting] = await Promise.all([
      scopedQuestions(this.prisma, context),
      sectionEditingBy(this.redis, this.prisma, pair),
      this.canRelease(context),
      this.timesOf(context),
      this.prisma.attempt.findFirst({ where: { testId: pair.testId }, select: { id: true } }),
    ]);
    const history = context.rows.filter((row) => row.replacedAt !== null);
    return {
      testId: pair.testId,
      baseConfigSectionId: pair.baseConfigSectionId,
      sectionName: context.section.name,
      languages: sectionLanguagesFor(context.section.languages, context.test.baseConfig.languages),
      testTitle: context.test.title,
      paperSource: context.test.paperSource,
      questionCount: context.section.questionCount,
      sectionSubjectId: context.section.subjectId,
      typingPreset: context.section.typingPreset as TypingPresetKey | null,
      answerKind: sectionAnswerKindOf(context.section),
      offered: context.test.finalizedAt !== null,
      sat: sitting !== null,
      typist: context.typist,
      reader: context.reader,
      history,
      seat: context.seat,
      seatAssignmentId: context.mine?.id ?? null,
      seatReplaced: context.mine?.replacedAt !== null && context.mine !== null,
      canRelease,
      editingBy,
      questions: scoped.map((question): SectionQuestion => ({
        questionId: question.id,
        preview: question.preview,
        difficulty: question.difficulty,
        order: question.order,
        typed: question.typed,
        review: question.review,
        editable: editable(context, question),
        deletable: deletable(context, question),
        time: times.get(question.id) ?? noTime(seesEverySeat(context)),
      })),
    };
  }

  /** Each question's time folded for the viewer: their own, and each seat's where they may see it. */
  private async timesOf(context: Context): Promise<Map<string, QuestionTime>> {
    const rows = await this.prisma.questionWorkTime.findMany({
      where: context.pair,
      select: { questionId: true, adminId: true, role: true, seconds: true },
    });
    const all = seesEverySeat(context);
    const times = new Map<string, QuestionTime>();
    for (const row of rows) {
      const time = times.get(row.questionId) ?? noTime(all);
      if (row.adminId === context.viewer.id) time.own += row.seconds;
      const seat = row.role === ASSIGNMENT_ROLES.TYPIST ? 'typist' : 'reader';
      if (all) time[seat] = (time[seat] ?? 0) + row.seconds;
      times.set(row.questionId, time);
    }
    return times;
  }

  /** Seconds the caller has just had this question on screen, added to their total in the seat they hold. */
  async spend(
    pair: Pair,
    questionId: string,
    seconds: number,
    viewer: SectionViewer,
  ): Promise<WorkTimeTotal> {
    const context = await this.load(pair, viewer);
    const own = heldNow(context);
    if (!own) throw new AppException(ErrorCodes.FORBIDDEN, SEATS_ONLY_MESSAGE);
    if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    await this.requireScoped(context, questionId);

    const key = { testId: pair.testId, questionId, adminId: viewer.id, role: own.role };
    return this.prisma.questionWorkTime.upsert({
      where: { testId_questionId_adminId_role: key },
      create: { ...key, baseConfigSectionId: pair.baseConfigSectionId, seconds },
      update: { seconds: { increment: seconds } },
      select: { seconds: true },
    });
  }

  /** The typist row a Done is taken under; its own state is the Done's to judge. */
  async actingTypist(pair: Pair, viewer: SectionViewer): Promise<Assignment> {
    return actingAs(await this.load(pair, viewer), ASSIGNMENT_ROLES.TYPIST);
  }

  /** The section as a Done leaves it: it is the reader's now, so no typing claim outlives it. */
  async handedOver(pair: Pair, viewer: SectionViewer): Promise<SectionWork> {
    await releaseSectionEditLock(this.redis, pair);
    return this.one(pair, viewer);
  }

  /** The viewer's turn has ended: their own claim goes, and the section answers as it now stands. */
  private async passedOn(context: Context): Promise<SectionWork> {
    await releaseSectionEditLock(this.redis, context.pair, context.viewer.id);
    return this.workOf(context);
  }

  /** A question typed for the section, under the open typing job the viewer acts through. */
  async create(pair: Pair, draft: QuestionDraft, viewer: SectionViewer): Promise<QuestionDetail> {
    const context = await this.load(pair, viewer);
    const typing = typingRow(context);
    assertTypeFits(context.section, draft);
    await takeSectionEditLock(this.redis, this.prisma, pair, viewer);
    return this.questions.create(draft, viewer.id, { assignmentId: typing.id });
  }

  /** The bank's sheet, previewed for this section: the run is the previewer's own from here on. */
  async previewImport(
    pair: Pair,
    file: Buffer,
    viewer: SectionViewer,
  ): Promise<QuestionImportPlan> {
    typingRow(await this.load(pair, viewer));
    return this.imports.preview(file, viewer.id, pair);
  }

  async commitImport(
    pair: Pair,
    importLogId: string,
    viewer: SectionViewer,
  ): Promise<QuestionImportResult> {
    const typing = typingRow(await this.load(pair, viewer));
    return this.imports.commit(importLogId, {
      section: { ...pair, assignmentId: typing.id },
      actorId: viewer.id,
    });
  }

  /** The reader's release, under the reading job the viewer acts through. */
  async release(pair: Pair, viewer: SectionViewer): Promise<SectionWork> {
    const reading = actingAs(await this.load(pair, viewer), ASSIGNMENT_ROLES.PROOFREADER);
    await this.assignments.finalize(reading.id);
    await releaseSectionEditLock(this.redis, pair, viewer.id);
    return this.one(pair, viewer);
  }

  /** The release's own rule, asked of the viewer's reading: the screen offers only what would be taken. */
  private async canRelease(context: Context): Promise<boolean> {
    const own = heldNow(context);
    if (own?.role !== ASSIGNMENT_ROLES.PROOFREADER || !own.canMarkRead) return false;
    const { pair, test, section } = context;
    const gap = await this.assignments.releaseGap(pair, test.paperSource, section.questionCount);
    return gap === null;
  }

  /** One question of the section — the list is not the authority, this is. */
  async question(pair: Pair, questionId: string, viewer: SectionViewer): Promise<QuestionDetail> {
    const context = await this.load(pair, viewer);
    await this.requireScoped(context, questionId);
    return this.questions.detail(questionId);
  }

  /** Saved under the viewer's own rule, over the one service that owns the tables. */
  async edit(
    pair: Pair,
    questionId: string,
    draft: QuestionDraft,
    viewer: SectionViewer,
  ): Promise<QuestionDetail> {
    const context = await this.load(pair, viewer);
    const question = await this.requireScoped(context, questionId);
    if (context.test.finalizedAt && !viewer.isSuperAdmin) {
      throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    }
    if (!editable(context, question)) {
      throw new AppException(ErrorCodes.FORBIDDEN, NOT_EDITABLE_MESSAGE);
    }
    assertTypeFits(context.section, draft);
    await takeSectionEditLock(this.redis, this.prisma, pair, {
      id: viewer.id,
      isSuperAdmin: viewer.isSuperAdmin,
    });
    const saved = await this.questions.update(questionId, draft, viewer.id);
    // The reader's own edit of any kind is read again: a rewording already is, by every seat.
    if (heldNow(context)?.role === ASSIGNMENT_ROLES.PROOFREADER && !context.test.finalizedAt) {
      await this.prisma.$transaction(async (tx) => {
        await beginDraftPaperEdit(tx, pair.testId, OFFERED_MESSAGE);
        await tx.questionReview.updateMany({
          where: { testId: pair.testId, questionId, checkedAt: { not: null } },
          data: { checkedAt: null },
        });
        await reopenReadingIfUnchecked(tx, pair.testId, pair.baseConfigSectionId);
      }, TX_LIMITS.SHORT);
    }
    // A rewording that sends a released section back to its reader gives the claim up with it.
    if (context.reader?.finalizedAt && (await jobOpen(this.prisma, context.reader.id))) {
      await releaseSectionEditLock(this.redis, pair, viewer.id);
    }
    return saved;
  }

  /** A typist's own mistake, taken back; `questions.remove` still refuses one a paper holds. */
  async remove(pair: Pair, questionId: string, viewer: SectionViewer): Promise<void> {
    const context = await this.load(pair, viewer);
    const question = await this.requireScoped(context, questionId);
    if (!deletable(context, question)) {
      throw new AppException(ErrorCodes.FORBIDDEN, NOT_DELETABLE_MESSAGE);
    }
    await takeSectionEditLock(this.redis, this.prisma, pair, viewer);
    await this.questions.remove(questionId);
  }

  async otherTests(
    pair: Pair,
    questionId: string,
    viewer: SectionViewer,
  ): Promise<QuestionOnOtherTest[]> {
    const context = await this.load(pair, viewer);
    await this.requireScoped(context, questionId);
    return otherTestsOf(this.prisma, pair.testId, questionId);
  }

  /** The reader's tick: looked at, and passed. */
  async check(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    const reading = this.requireReading(context);
    await this.requireOnPaper(pair, questionId);

    const checked = { checkedAt: new Date(), checkedById: viewer.id };
    await this.reviewing(reading, async (tx) => {
      const review = await reviewRow(tx, pair.testId, questionId);
      if (isOpenSendBack(review)) throw new AppException(ErrorCodes.CONFLICT, WITH_TYPIST_MESSAGE);
      await tx.questionReview.upsert({
        where: { testId_questionId: { testId: pair.testId, questionId } },
        create: { ...pair, questionId, ...checked },
        update: checked,
      });
    });
    return this.passedOn(context);
  }

  async uncheck(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    const reading = this.requireReading(context);
    await this.requireOnPaper(pair, questionId);
    await this.reviewing(reading, (tx) =>
      tx.questionReview.updateMany({
        where: { testId: pair.testId, questionId },
        data: { checkedAt: null, checkedById: null },
      }),
    );
    return this.workOf(context);
  }

  /** One question back to the typist with a reason; the rest of the section stays with the reader. */
  async sendBack(
    pair: Pair,
    questionId: string,
    body: SendBackBody,
    viewer: SectionViewer,
  ): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    const reading = this.requireReading(context);
    if (!context.typist) throw new AppException(ErrorCodes.CONFLICT, NO_TYPIST_MESSAGE);
    await this.requireOnPaper(pair, questionId);

    const sent = {
      sentBackAt: new Date(),
      reason: body.reason,
      note: body.note ?? null,
      sentBackById: viewer.id,
      fixedAt: null,
      fixedById: null,
      checkedAt: null,
      checkedById: null,
    };
    await this.reviewing(reading, (tx) =>
      tx.questionReview.upsert({
        where: { testId_questionId: { testId: pair.testId, questionId } },
        create: { ...pair, questionId, ...sent },
        update: sent,
      }),
    );
    return this.passedOn(context);
  }

  /** The typist's answer to a send-back: it goes back to the reader to be checked again. */
  async fixed(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    const own = heldNow(context);
    if (own?.role !== ASSIGNMENT_ROLES.TYPIST) {
      throw new AppException(ErrorCodes.FORBIDDEN, TYPISTS_ONLY_MESSAGE);
    }
    if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    await this.requireOnPaper(pair, questionId);
    await this.prisma.$transaction(async (tx) => {
      // The row a send-back takes too, so the one read here is the one this answers.
      await beginDraftPaperEdit(tx, pair.testId, OFFERED_MESSAGE);
      const review = await reviewRow(tx, pair.testId, questionId);
      if (!isOpenSendBack(review)) {
        throw new AppException(ErrorCodes.CONFLICT, NOT_SENT_BACK_MESSAGE);
      }
      await tx.questionReview.update({
        where: { testId_questionId: { testId: pair.testId, questionId } },
        data: { fixedAt: new Date(), fixedById: viewer.id },
      });
    }, TX_LIMITS.SHORT);
    return this.passedOn(context);
  }

  /** A reader's write takes its turn on the test's row, and is refused there once a release has landed. */
  private async reviewing(
    reading: Assignment,
    write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await assertJobOpen(tx, reading.id);
      await write(tx);
    }, TX_LIMITS.SHORT);
  }

  private async load(pair: Pair, viewer: SectionViewer): Promise<Context> {
    const test = await this.prisma.test.findUnique({
      where: { id: pair.testId },
      select: {
        title: true,
        baseConfigId: true,
        paperSource: true,
        finalizedAt: true,
        baseConfig: { select: { languages: true } },
      },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    const [sectionResult, rowsResult] = await Promise.allSettled([
      this.prisma.baseConfigSection.findFirst({
        where: { id: pair.baseConfigSectionId, baseConfigId: test.baseConfigId },
        select: {
          name: true,
          questionCount: true,
          subjectId: true,
          typingPreset: true,
          descriptive: true,
          languages: true,
        },
      }),
      this.assignments.sectionAssignments(pair.testId, pair.baseConfigSectionId, viewer),
    ]);
    if (sectionResult.status === 'rejected') throw sectionResult.reason;
    const section = sectionResult.value;
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (rowsResult.status === 'rejected') throw rowsResult.reason;
    const rows = rowsResult.value;
    const active = rows.filter((row) => row.replacedAt === null);
    const own = rows.filter((row) => row.assigneeId === viewer.id);
    const mine = own.find((row) => row.replacedAt === null) ?? own.at(-1) ?? null;
    const owns = can(viewer, FEATURE_KEYS.TEST_MANAGEMENT);
    // Not theirs reads as not there: a feature key is not a seat on this section.
    if (!mine && !owns) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    assertSourceChosen(test);

    let seat: SectionSeat = SECTION_SEATS.OWNER;
    // A test owner whose own seat has passed on reads the section as its owner again.
    if (mine && !(mine.replacedAt && owns))
      seat = mine.role === ASSIGNMENT_ROLES.TYPIST ? SECTION_SEATS.TYPIST : SECTION_SEATS.READER;

    return {
      pair,
      viewer,
      test: { ...test, paperSource: test.paperSource },
      section,
      rows,
      typist: active.find((row) => row.role === ASSIGNMENT_ROLES.TYPIST) ?? null,
      reader: active.find((row) => row.role === ASSIGNMENT_ROLES.PROOFREADER) ?? null,
      mine,
      seat,
      ownerWrites: can(viewer, FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE),
    };
  }

  private async requireScoped(context: Context, questionId: string): Promise<ScopedQuestion> {
    const found = (await scopedQuestions(this.prisma, context)).find(
      (question) => question.id === questionId,
    );
    if (!found) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    return found;
  }

  private requireReading(context: Context): Assignment {
    const own = heldNow(context);
    if (own?.role !== ASSIGNMENT_ROLES.PROOFREADER) {
      throw new AppException(ErrorCodes.FORBIDDEN, READERS_ONLY_MESSAGE);
    }
    if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    if (!own.handedAt) throw new AppException(ErrorCodes.CONFLICT, NOT_HANDED_MESSAGE);
    if (own.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, RELEASED_MESSAGE);
    return own;
  }

  private async requireOnPaper(pair: Pair, questionId: string): Promise<void> {
    const row = await this.prisma.paperQuestion.findFirst({
      where: { ...pair, questionId },
      select: { id: true },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
  }
}
