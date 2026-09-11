import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  DIFFICULTY_LEVELS,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_STATUS,
  type BaseConfigDetail,
  quotaWithPicks,
  sectionQuota,
  type DifficultyMix,
  type DrawShortfall,
  type DrawSpec,
  type SectionQuota,
  type AddPaperQuestionBody,
  type ReplacePaperQuestionBody,
  type SetPaperQuestionStatusBody,
  type TestPaper,
  type LocalizedContent,
  type TestScope,
  type TestScopeRef,
  scopedSections,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { BaseConfigsService } from '../configs';
import { drawPaper, type DrawCandidate, type DrawnQuestion, type DrawSection } from './draw-engine';
import { SAT_TEST_MESSAGE } from './test-rules';
import { thaw } from './thaw';
import { stemPreviewOf } from '../questions';
import { ScoringOutbox } from '../attempts';
import { AuditContext } from '../audit';

const NOT_DRAWABLE_MESSAGE = 'That question is not live, so no paper can serve it.';
const WRONG_SUBJECT_MESSAGE = 'That question belongs to another subject than this section draws.';
const ALREADY_ON_THE_PAPER_MESSAGE = 'That question is already on this paper.';
const NOT_FROZEN_MESSAGE =
  'Only a finalized paper can have a question dropped or made a bonus. Edit the draft instead.';
const NO_SUCH_SECTION_MESSAGE = 'No such section on this paper';
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
  ) {}

  async read(testId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    const config = await this.configs.detail(test.baseConfigId);
    return this.paperOf(test.id, this.scopedOf(test, config));
  }

  /** Several at once, numbered from the section's current highest order; every one resolved and checked before any write. */
  async addQuestions(testId: string, input: AddPaperQuestionBody): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find((row) => row.id === input.baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);

    this.assertNoRepeats(input.questionIds);

    const questions: Awaited<ReturnType<PaperService['requireDrawable']>>[] = [];
    for (const questionId of input.questionIds) {
      const question = await this.requireDrawable(questionId, section.id);
      await this.assertNotAlreadyOnThePaper(testId, '', question.id);
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
      await thaw(tx, test);
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
  async fillSection(testId: string, baseConfigSectionId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    const config = await this.configs.detail(test.baseConfigId);
    const section = this.scopedOf(test, config).find((row) => row.id === baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SECTION_MESSAGE);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      select: HELD_SELECT,
    });
    const spec = sectionSpec((test.questionPoolFilter as DrawSpec | null) ?? null, section.id);
    const added = await this.drawRemainder(section, spec, rows);
    if (added.length === 0) return this.paperOf(testId, this.scopedOf(test, config));

    const highest = rows.reduce((max, row) => Math.max(max, row.order), 0);
    await this.prisma.$transaction(async (tx) => {
      await thaw(tx, test);
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
    spec: DrawSpec | null,
    rows: readonly HeldRow[],
  ): Promise<DrawnQuestion[]> {
    const held = rows.filter((row) => row.baseConfigSectionId === section.id);
    const drawSection = toDrawSection(section);
    // One question sits on a paper once, so every row already on it is out of this draw's reach.
    const onPaper = new Set(rows.map((row) => row.questionId));
    const pool = (await this.poolFor([drawSection], spec)).filter(
      (candidate) => !onPaper.has(candidate.id),
    );

    const pins = await this.pinsOf(held);
    // Judged on the pins alone, so what the bank happens to stock cannot change the verdict.
    assertWithinSplit(
      section.name,
      sectionQuota(
        mixOf(spec, section.id),
        pins.map((pin) => pin.difficulty),
      ),
      FORM_LEVEL_FIELD,
    );

    const result = drawPaper({
      sections: [drawSection],
      pool,
      spec,
      seed: freshSeed(),
      pinned: new Map([[section.id, pins]]),
    });
    if (!result.ok) {
      throw new AppException(ErrorCodes.DRAW_SHORTFALL, SECTION_TOO_THIN_MESSAGE, {
        fieldErrors: shortfallErrors(sectionShortfalls(result.shortfalls)),
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
      return question
        ? [toCandidate({ ...question, currentVersionId: row.questionVersionId })]
        : [];
    });
  }

  /** One row swapped for another question, keeping its place in the paper. */
  async replaceQuestion(
    testId: string,
    rowId: string,
    input: ReplacePaperQuestionBody,
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    const row = await this.requireRow(testId, rowId);
    const question = await this.requireDrawable(input.questionId, row.baseConfigSectionId);
    await this.assertNotAlreadyOnThePaper(testId, rowId, question.id);

    await this.prisma.$transaction(async (tx) => {
      await thaw(tx, test);
      await tx.paperQuestion.update({
        where: { id: rowId },
        data: { questionId: question.id, questionVersionId: question.currentVersionId },
      });
    });

    return this.paperOf(testId, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  /** Dropped, leaving its section short of the count its config asks for until one is drawn. */
  async removeQuestions(testId: string, rowIds: readonly string[]): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    // Every row resolved before any is deleted: a half-removed batch is one nobody can reason about.
    for (const rowId of rowIds) await this.requireRow(testId, rowId);

    await this.prisma.$transaction(async (tx) => {
      await thaw(tx, test);
      await tx.paperQuestion.deleteMany({ where: { testId, id: { in: [...rowIds] } } });
    });

    return this.paperOf(testId, this.scopedOf(test, await this.configs.detail(test.baseConfigId)));
  }

  /** The only change a LOCKED paper allows; a draft's question is edited, never withdrawn. */
  async setQuestionStatus(
    testId: string,
    rowId: string,
    { status, reason }: SetPaperQuestionStatusBody,
  ): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    if (!test.isLocked) {
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
        sittings: await this.outbox.rescore(tx, { testId, questionId: row.questionId }),
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

    if (question?.status !== QUESTION_STATUS.ACTIVE || !question.currentVersionId) {
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
    rowId: string,
    questionId: string,
  ): Promise<void> {
    const held = await this.prisma.paperQuestion.findFirst({
      where: { testId, questionId, id: { not: rowId } },
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

  /** Only ACTIVE questions carrying a current version: a paper pins a version, so there must be one. */
  private async poolFor(
    sections: readonly DrawSection[],
    spec: DrawSpec | null,
  ): Promise<DrawCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        status: QUESTION_STATUS.ACTIVE,
        currentVersionId: { not: null },
        ...subjectWhere(sections),
        ...topicWhere(spec),
      },
      select: CANDIDATE_SELECT,
    });
    return rows.filter(hasVersion).map(toCandidate);
  }

  private assertAssemblable(test: { attemptCount: number }): void {
    if (test.attemptCount > 0) {
      throw new AppException(ErrorCodes.CONFLICT, SAT_TEST_MESSAGE, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [SAT_TEST_MESSAGE] },
      });
    }
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
        isLocked: true,
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

/** No section takes anything, so the bank narrows to the subjects the paper is actually made of. */
function subjectWhere(sections: readonly DrawSection[]): Prisma.QuestionWhereInput {
  const subjects = sections.map((section) => section.subjectId);
  if (subjects.includes(null)) return {};
  return { subjectId: { in: subjects.filter((id): id is string => id !== null) } };
}

/** The narrowing SQL can do. The section's own subject is the engine's, per section. */
/** Every topic any section names. A section that names none is narrowed by its subject alone. */
function topicWhere(spec: DrawSpec | null): Prisma.QuestionWhereInput {
  const sections = Object.values(spec?.sections ?? {});
  if (sections.length === 0 || sections.some((section) => !section.topicIds?.length)) return {};

  const topicIds = [...new Set(sections.flatMap((section) => section.topicIds ?? []))];
  return { topicId: { in: topicIds } };
}

/** The engine's own shortfall, in the shape the shared message builder reads. */
function sectionShortfalls(
  gaps: readonly {
    baseConfigSectionId: string;
    sectionName: string;
    needed: number;
    available: number;
  }[],
): DrawShortfall[] {
  return gaps.map((gap) => ({ ...gap, difficulty: null }));
}

/** One message per short bucket, keyed by section so the form puts it beside the right one. */
function shortfallErrors(gaps: readonly DrawShortfall[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const gap of gaps) {
    const what = gap.difficulty ? `${gap.needed} ${gap.difficulty.toLowerCase()}` : `${gap.needed}`;
    const held = (errors[gap.baseConfigSectionId] ??= []);
    held.push(`${gap.sectionName} needs ${what}, and the bank holds ${gap.available}.`);
  }
  return errors;
}

function hasVersion(row: CandidateRow): row is CandidateRow & { currentVersionId: string } {
  return row.currentVersionId !== null;
}

function toCandidate(row: CandidateRow & { currentVersionId: string }): DrawCandidate {
  return {
    id: row.id,
    currentVersionId: row.currentVersionId,
    subjectId: row.subjectId,
    topicId: row.topicId,
    difficulty: row.difficulty,
    tags: row.tags,
  };
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

/** One section's own narrowing, alone: another section's topics must not shrink this one's pool. */
function sectionSpec(spec: DrawSpec | null, sectionId: string): DrawSpec | null {
  const held = spec?.sections?.[sectionId];
  return held ? { sections: { [sectionId]: held } } : null;
}

function toDrawSection(section: BaseConfigDetail['sections'][number]): DrawSection {
  return {
    id: section.id,
    name: section.name,
    order: section.order,
    subjectId: section.subjectId,
    questionCount: section.questionCount,
    marksPerQuestion: section.marksPerQuestion,
    negativeMarks: section.negativeMarks,
  };
}

const SEED_CEILING = 2 ** 31;

/** A re-draw the admin did not seed should give a different paper — that is what re-draw means. */
function freshSeed(): number {
  return randomInt(SEED_CEILING);
}
