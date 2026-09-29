import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  REVIEW_STATES,
  SECTION_SEATS,
  can,
  type AdminAuthority,
  type Assignment,
  type AssignmentRole,
  type DifficultyLevel,
  type LocalizedContent,
  type PaperSource,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionOnOtherTest,
  type QuestionReview,
  type SectionQuestion,
  type SectionSeat,
  type SectionWork,
  type SendBackBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { sectionEditingBy, takeSectionEditLock } from '../common/edit-lock';
import { AssignmentsService } from '../assignments';
import { stemPreviewOf } from './question-core';
import { QuestionImportService } from './question-import.service';
import { reachableTest } from './question-query';
import { QuestionsService } from './questions.service';

/** Who is asking: the controller knows their grants, this service knows the section. */
export interface SectionViewer extends AdminAuthority {
  id: string;
}

interface Pair {
  testId: string;
  baseConfigSectionId: string;
}

/** Everything a rule about the section turns on, read once per request. */
interface Context {
  pair: Pair;
  viewer: SectionViewer;
  test: {
    title: string | null;
    paperSource: PaperSource;
    finalizedAt: Date | null;
  };
  section: { name: string; questionCount: number; subjectId: string | null };
  rows: Assignment[];
  typist: Assignment | null;
  reader: Assignment | null;
  /** The viewer's own row: the one they hold now, else the last they held. */
  mine: Assignment | null;
  seat: SectionSeat;
  ownerWrites: boolean;
}

interface ScopedQuestion {
  id: string;
  order: number | null;
  typed: boolean;
  createdById: string | null;
  difficulty: DifficultyLevel;
  preview: string;
  review: QuestionReview;
}

const NOT_YOURS = 'No such section';
const OFFERED_MESSAGE = 'This test has been offered, so its questions no longer change here.';
const NOT_EDITABLE_MESSAGE = 'This question is not yours to change at this point in the section.';
const NOT_DELETABLE_MESSAGE =
  'Only a question you typed for this section, and may still change, can be deleted.';
const SOURCE_UNCHOSEN_MESSAGE = 'Say where this test gets its questions before working on it.';
const READERS_ONLY_MESSAGE = "Only this section's proof-reader reviews its questions.";
const NOT_HANDED_MESSAGE = 'This section has not reached you yet.';
const RELEASED_MESSAGE = 'You have released this section, so its review is closed.';
const WITH_TYPIST_MESSAGE = 'This question is with the typist until they mark it fixed.';
const NO_TYPIST_MESSAGE = 'This section has no typist to send a question back to.';
const NOT_SENT_BACK_MESSAGE = 'This question was not sent back to you.';
const TYPISTS_ONLY_MESSAGE = "Only this section's typist marks a question fixed.";
const TYPING_ONLY_MESSAGE = "Only this section's typist does that.";
const NO_LONGER_TYPING_MESSAGE =
  'This section is no longer yours, so nothing new is typed into it.';
const NOTHING_TO_TYPE_MESSAGE =
  'This test is picked from the bank, so its sections are not typed. Fix what is sent back to you.';
const SECTION_HANDED_OVER_MESSAGE =
  'You have marked this section done. New questions go to the bank, not this paper.';

const UNCHECKED_REVIEW: QuestionReview = {
  state: REVIEW_STATES.UNCHECKED,
  reason: null,
  note: null,
  sentBackAt: null,
  fixedAt: null,
  checkedAt: null,
};

type ReviewRow = Prisma.QuestionReviewGetPayload<object>;

const isOpenSendBack = (row: ReviewRow | null | undefined): boolean =>
  Boolean(row?.sentBackAt && !row.fixedAt);

function reviewOf(row: ReviewRow | undefined): QuestionReview {
  if (!row) return UNCHECKED_REVIEW;
  let state: QuestionReview['state'] = REVIEW_STATES.UNCHECKED;
  if (isOpenSendBack(row)) state = REVIEW_STATES.SENT_BACK;
  else if (row.checkedAt) state = REVIEW_STATES.CHECKED;
  else if (row.fixedAt) state = REVIEW_STATES.FIXED;
  return {
    state,
    reason: row.reason,
    note: row.note,
    sentBackAt: row.sentBackAt?.toISOString() ?? null,
    fixedAt: row.fixedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
  };
}

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
    const [scoped, editingBy, canRelease] = await Promise.all([
      this.scoped(context),
      sectionEditingBy(this.redis, this.prisma, pair),
      this.canRelease(context),
    ]);
    const history = context.rows.filter((row) => row.replacedAt !== null);
    return {
      testId: pair.testId,
      baseConfigSectionId: pair.baseConfigSectionId,
      sectionName: context.section.name,
      testTitle: context.test.title,
      paperSource: context.test.paperSource,
      questionCount: context.section.questionCount,
      sectionSubjectId: context.section.subjectId,
      offered: context.test.finalizedAt !== null,
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
        editable: this.editable(context, question),
        deletable: this.deletable(context, question),
      })),
    };
  }

  /** The typist row a Done is taken under; its own state is the Done's to judge. */
  async actingTypist(pair: Pair, viewer: SectionViewer): Promise<Assignment> {
    return actingAs(await this.load(pair, viewer), ASSIGNMENT_ROLES.TYPIST);
  }

  /** A question typed for the section, under the open typing job the viewer acts through. */
  async create(pair: Pair, draft: QuestionDraft, viewer: SectionViewer): Promise<QuestionDetail> {
    const typing = typingRow(await this.load(pair, viewer));
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
    return this.imports.preview(file, viewer.id);
  }

  async commitImport(
    pair: Pair,
    importLogId: string,
    viewer: SectionViewer,
  ): Promise<QuestionImportResult> {
    const typing = typingRow(await this.load(pair, viewer));
    return this.imports.commit(importLogId, { assignmentId: typing.id, actorId: viewer.id });
  }

  /** The reader's release, under the reading job the viewer acts through. */
  async release(pair: Pair, viewer: SectionViewer): Promise<SectionWork> {
    const reading = actingAs(await this.load(pair, viewer), ASSIGNMENT_ROLES.PROOFREADER);
    await this.assignments.finalize(reading.id);
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
    if (!this.editable(context, question)) {
      throw new AppException(ErrorCodes.FORBIDDEN, NOT_EDITABLE_MESSAGE);
    }
    await takeSectionEditLock(this.redis, this.prisma, pair, {
      id: viewer.id,
      isSuperAdmin: viewer.isSuperAdmin,
    });
    return this.questions.update(questionId, draft, viewer.id);
  }

  /** A typist's own mistake, taken back; `questions.remove` still refuses one a paper holds. */
  async remove(pair: Pair, questionId: string, viewer: SectionViewer): Promise<void> {
    const context = await this.load(pair, viewer);
    const question = await this.requireScoped(context, questionId);
    if (!this.deletable(context, question)) {
      throw new AppException(ErrorCodes.FORBIDDEN, NOT_DELETABLE_MESSAGE);
    }
    await takeSectionEditLock(this.redis, this.prisma, pair, viewer);
    await this.questions.remove(questionId);
  }

  /** Which other tests hold this question, asked before the edit rather than reported after it. */
  async otherTests(
    pair: Pair,
    questionId: string,
    viewer: SectionViewer,
  ): Promise<QuestionOnOtherTest[]> {
    const context = await this.load(pair, viewer);
    await this.requireScoped(context, questionId);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { questionId, testId: { not: pair.testId } },
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
    const open = await this.prisma.test.findMany({
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

  /** The reader's tick: looked at, and passed. */
  async check(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    this.requireReading(context);
    await this.requireOnPaper(pair, questionId);
    const review = await this.reviewRow(pair.testId, questionId);
    if (isOpenSendBack(review)) throw new AppException(ErrorCodes.CONFLICT, WITH_TYPIST_MESSAGE);

    const checked = { checkedAt: new Date(), checkedById: viewer.id };
    await this.prisma.questionReview.upsert({
      where: { testId_questionId: { testId: pair.testId, questionId } },
      create: { ...pair, questionId, ...checked },
      update: checked,
    });
    return this.workOf(context);
  }

  async uncheck(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    this.requireReading(context);
    await this.prisma.questionReview.updateMany({
      where: { testId: pair.testId, questionId },
      data: { checkedAt: null, checkedById: null },
    });
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
    this.requireReading(context);
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
    await this.prisma.questionReview.upsert({
      where: { testId_questionId: { testId: pair.testId, questionId } },
      create: { ...pair, questionId, ...sent },
      update: sent,
    });
    return this.workOf(context);
  }

  /** The typist's answer to a send-back: it goes back to the reader to be checked again. */
  async fixed(pair: Pair, questionId: string, viewer: SectionViewer): Promise<SectionWork> {
    const context = await this.load(pair, viewer);
    const own = heldNow(context);
    if (own?.role !== ASSIGNMENT_ROLES.TYPIST) {
      throw new AppException(ErrorCodes.FORBIDDEN, TYPISTS_ONLY_MESSAGE);
    }
    if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    const review = await this.reviewRow(pair.testId, questionId);
    if (!isOpenSendBack(review)) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_SENT_BACK_MESSAGE);
    }
    await this.prisma.questionReview.update({
      where: { testId_questionId: { testId: pair.testId, questionId } },
      data: { fixedAt: new Date(), fixedById: viewer.id },
    });
    return this.workOf(context);
  }

  private async load(pair: Pair, viewer: SectionViewer): Promise<Context> {
    const test = await this.prisma.test.findUnique({
      where: { id: pair.testId },
      select: {
        title: true,
        baseConfigId: true,
        paperSource: true,
        finalizedAt: true,
      },
    });
    const section = test
      ? await this.prisma.baseConfigSection.findFirst({
          where: { id: pair.baseConfigSectionId, baseConfigId: test.baseConfigId },
          select: { name: true, questionCount: true, subjectId: true },
        })
      : null;
    if (!test || !section) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    const rows = await this.assignments.sectionAssignments(pair.testId, pair.baseConfigSectionId);
    const active = rows.filter((row) => row.replacedAt === null);
    const own = rows.filter((row) => row.assigneeId === viewer.id);
    const mine = own.find((row) => row.replacedAt === null) ?? own.at(-1) ?? null;
    // Not theirs reads as not there: a feature key is not a seat on this section.
    if (!mine && !can(viewer, FEATURE_KEYS.TEST_MANAGEMENT)) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }
    if (!test.paperSource) throw new AppException(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE);

    let seat: SectionSeat = SECTION_SEATS.OWNER;
    if (mine)
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

  /** The paper in its order, then what was typed for it and not chosen; a reader sees the paper once it reaches them. */
  private async scoped(context: Context): Promise<ScopedQuestion[]> {
    const { pair } = context;
    const paper = await this.prisma.paperQuestion.findMany({
      where: pair,
      select: { questionId: true, order: true },
      orderBy: { order: 'asc' },
    });
    if (context.seat === SECTION_SEATS.READER && !context.mine?.handedAt) return [];

    const onPaper = paper.map((row) => row.questionId);
    const typed =
      context.seat === SECTION_SEATS.READER
        ? []
        : await this.prisma.question.findMany({
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
      this.prisma.question.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          difficulty: true,
          createdById: true,
          assignment: { select: { testId: true, baseConfigSectionId: true, role: true } },
          currentVersion: { select: { content: true } },
        },
      }),
      this.prisma.questionReview.findMany({
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

  /** The rule each seat works under; a test owner's is the section being back with them. */
  private editable(context: Context, question: ScopedQuestion): boolean {
    if (context.test.finalizedAt) return context.viewer.isSuperAdmin;
    if (context.viewer.isSuperAdmin) return true;

    const own = typingOrHeld(context);
    if (own?.role === ASSIGNMENT_ROLES.TYPIST) {
      if (question.review.state === REVIEW_STATES.SENT_BACK) return true;
      const typing = context.test.paperSource === PAPER_SOURCES.FRAMED && !own.finalizedAt;
      if (typing && question.typed) return true;
    }
    if (own?.role === ASSIGNMENT_ROLES.PROOFREADER) {
      if (own.handedAt && !own.finalizedAt && question.order !== null) return true;
    }
    return context.ownerWrites && withOwner(context);
  }

  /** A draft typed here by the viewer, off the paper, that they may still change; a paper row is never deleted. */
  private deletable(context: Context, question: ScopedQuestion): boolean {
    const { viewer } = context;
    const own = viewer.isSuperAdmin || question.createdById === viewer.id;
    return question.typed && question.order === null && own && this.editable(context, question);
  }

  private async requireScoped(context: Context, questionId: string): Promise<ScopedQuestion> {
    const found = (await this.scoped(context)).find((question) => question.id === questionId);
    if (!found) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    return found;
  }

  private requireReading(context: Context): void {
    const own = heldNow(context);
    if (own?.role !== ASSIGNMENT_ROLES.PROOFREADER) {
      throw new AppException(ErrorCodes.FORBIDDEN, READERS_ONLY_MESSAGE);
    }
    if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    if (!own.handedAt) throw new AppException(ErrorCodes.CONFLICT, NOT_HANDED_MESSAGE);
    if (own.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, RELEASED_MESSAGE);
  }

  private async requireOnPaper(pair: Pair, questionId: string): Promise<void> {
    const row = await this.prisma.paperQuestion.findFirst({
      where: { ...pair, questionId },
      select: { id: true },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
  }

  private reviewRow(testId: string, questionId: string) {
    return this.prisma.questionReview.findUnique({
      where: { testId_questionId: { testId, questionId } },
    });
  }
}

/** For a super admin whoever holds the role now, a seat they once left included; else the viewer's own row in it. */
function actingAs(context: Context, role: AssignmentRole): Assignment {
  const holder = role === ASSIGNMENT_ROLES.TYPIST ? context.typist : context.reader;
  if (holder && context.viewer.isSuperAdmin) return holder;
  if (context.mine?.role === role) return context.mine;
  const only = role === ASSIGNMENT_ROLES.TYPIST ? TYPING_ONLY_MESSAGE : READERS_ONLY_MESSAGE;
  throw new AppException(ErrorCodes.FORBIDDEN, only);
}

/** A typing job still open: held, on a typed paper, and not yet done. */
function typingRow(context: Context): Assignment {
  const row = actingAs(context, ASSIGNMENT_ROLES.TYPIST);
  if (row.replacedAt) throw new AppException(ErrorCodes.FORBIDDEN, NO_LONGER_TYPING_MESSAGE);
  if (context.test.paperSource !== PAPER_SOURCES.FRAMED) {
    throw new AppException(ErrorCodes.CONFLICT, NOTHING_TO_TYPE_MESSAGE);
  }
  if (row.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, SECTION_HANDED_OVER_MESSAGE);
  return row;
}

/** The row the viewer holds right now; a replaced one only reads. */
const heldNow = (context: Context): Assignment | null =>
  context.mine?.replacedAt === null ? context.mine : null;

/** The row held now, or the section's last typist row when nobody took the seat after it: those drafts are nobody else's. */
function typingOrHeld(context: Context): Assignment | null {
  const held = heldNow(context);
  if (held || context.typist) return held;
  const last = context.rows.filter((row) => row.role === ASSIGNMENT_ROLES.TYPIST).at(-1);
  return last && last.id === context.mine?.id ? last : null;
}

/** Picked and not yet handed on, or released by its reader: then the section is back with its owner. */
function withOwner(context: Context): boolean {
  const { reader } = context;
  if (reader?.finalizedAt) return true;
  return context.test.paperSource === PAPER_SOURCES.PICKED && !reader?.handedAt;
}
