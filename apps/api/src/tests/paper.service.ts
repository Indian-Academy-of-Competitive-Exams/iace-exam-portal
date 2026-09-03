import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  QUESTION_STATUS,
  type BaseConfigDetail,
  paperFeasibility,
  type DrawShortfall,
  type DrawSpec,
  type FeasibilitySection,
  type SectionAvailability,
  type AddPaperQuestionBody,
  type PaperQuestionStatus,
  type ReplacePaperQuestionBody,
  type TestPaper,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { BaseConfigsService } from '../configs';
import { drawPaper, type DrawCandidate, type DrawSection } from './draw-engine';
import { SAT_TEST_MESSAGE } from './test-rules';
import { ScoringOutbox } from '../attempts';
import { AuditContext } from '../audit';

/** The one a FIXED test has, and the first a GENERATED test draws. */
const FIXED_VARIANT = 0;

const NOT_DRAWABLE_MESSAGE = 'That question is not live, so no paper can serve it.';
const WRONG_SUBJECT_MESSAGE = 'That question belongs to another subject than this section draws.';
const ALREADY_ON_THE_PAPER_MESSAGE = 'That question is already on this paper.';
const NOT_FROZEN_MESSAGE =
  'Only a finalized paper can have a question dropped or made a bonus. Edit the draft instead.';
import { thaw } from './thaw';

const CANDIDATE_SELECT = {
  id: true,
  currentVersionId: true,
  subjectId: true,
  topicId: true,
  difficulty: true,
  tags: true,
  createdAt: true,
  fixedUseCount: true,
} as const satisfies Prisma.QuestionSelect;

type CandidateRow = Prisma.QuestionGetPayload<{ select: typeof CANDIDATE_SELECT }>;

const PAPER_INCLUDE = {
  question: {
    select: { id: true, questionCode: true, difficulty: true, subjectId: true, topicId: true },
  },
} as const satisfies Prisma.PaperQuestionInclude;

export const GENERATED_HAS_NO_PAPER_MESSAGE =
  'This test draws a fresh paper for each student, so there is no one paper to edit. Switch it to a fixed paper first.';

/** A test's paper: read, drawn at finalize, or edited a question at a time until the freeze. */
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
    return this.paperOf(test.id, config);
  }

  /** The papers a GENERATED test hands out. DRAWN only — writing them belongs behind the freeze. */
  async drawVariants(
    testId: string,
    count: number,
  ): Promise<Prisma.PaperQuestionCreateManyInput[]> {
    const test = await this.requireTest(testId);
    const config = await this.configs.detail(test.baseConfigId);
    const sections = config.sections.map(toDrawSection);
    const spec = (test.questionPoolFilter as DrawSpec | null) ?? null;

    if (count < 1) {
      const none = 'A drawn test needs at least one paper to hand out.';
      throw new AppException(ErrorCodes.VALIDATION_ERROR, none, {
        fieldErrors: { variantCount: [none] },
      });
    }

    const pool = await this.poolFor(sections, spec);
    this.assertBankCanFill(config.sections, spec, pool);

    const papers = Array.from(
      { length: count },
      (_, variant): Prisma.PaperQuestionCreateManyInput[] => {
        const result = drawPaper({
          sections,
          pool,
          strategy: test.drawStrategy,
          spec,
          // A seed per variant, so the same test drawn twice gives the same set of papers.
          seed: freshSeed() + variant,
        });
        if (!result.ok) {
          throw new AppException(
            ErrorCodes.DRAW_SHORTFALL,
            'The bank does not hold enough questions to fill every section of this paper.',
            { fieldErrors: shortfallErrors(sectionShortfalls(result.shortfalls)) },
          );
        }
        return result.questions.map((row) => ({
          ...row,
          variant,
          testId,
          baseConfigId: test.baseConfigId,
        }));
      },
    );

    return papers.flat();
  }

  /** Takes the caller's transaction because the only safe place to write a paper is behind a gate. */
  async writeVariants(
    tx: Prisma.TransactionClient,
    testId: string,
    rows: readonly Prisma.PaperQuestionCreateManyInput[],
  ): Promise<void> {
    await tx.paperQuestion.deleteMany({ where: { testId } });
    await tx.paperQuestion.createMany({ data: [...rows] });
  }

  /** One more question, in the next free place its section has. Refused once the section is full. */
  async addQuestion(testId: string, input: AddPaperQuestionBody): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    const config = await this.configs.detail(test.baseConfigId);
    const section = config.sections.find((row) => row.id === input.baseConfigSectionId);
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, 'No such section on this paper');

    const question = await this.requireDrawable(input.questionId, section.id);
    await this.assertNotAlreadyOnThePaper(testId, '', question.id);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId, variant: FIXED_VARIANT },
      select: { order: true, baseConfigSectionId: true },
    });
    const inSection = rows.filter((row) => row.baseConfigSectionId === section.id).length;
    if (inSection >= section.questionCount) {
      const full = `${section.name} already holds the ${section.questionCount} it needs. Take one off first.`;
      throw new AppException(ErrorCodes.CONFLICT, full, { fieldErrors: { questionId: [full] } });
    }

    const order = rows.reduce((highest, row) => Math.max(highest, row.order), 0) + 1;
    await this.prisma.$transaction(async (tx) => {
      await thaw(tx, test);
      await tx.paperQuestion.create({
        data: {
          testId,
          baseConfigId: test.baseConfigId,
          baseConfigSectionId: section.id,
          questionId: question.id,
          questionVersionId: question.currentVersionId,
          order,
          marks: section.marksPerQuestion,
          negativeMarks: section.negativeMarks,
        },
      });
    });

    return this.paperOf(testId, config);
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

    return this.paperOf(testId, await this.configs.detail(test.baseConfigId));
  }

  /** Dropped, leaving its section short of the count its config asks for until one is drawn. */
  async removeQuestion(testId: string, rowId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });
    await this.requireRow(testId, rowId);

    await this.prisma.$transaction(async (tx) => {
      await thaw(tx, test);
      await tx.paperQuestion.delete({ where: { id: rowId } });
    });

    return this.paperOf(testId, await this.configs.detail(test.baseConfigId));
  }

  /** The only change a LOCKED paper allows; a draft's question is edited, never withdrawn. */
  async setQuestionStatus(
    testId: string,
    rowId: string,
    status: PaperQuestionStatus,
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
      this.auditContext.setChanged({ status: { from: row.status, to: status } });
      this.logger.log(
        `Question ${row.questionId} on test ${testId} is ${status} across ${asked.rows} paper rows; ${asked.sittings} sittings to re-score`,
      );
    }
    return this.paperOf(testId, await this.configs.detail(test.baseConfigId), row.variant);
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
        variant: true,
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
      select: { id: true, status: true, subjectId: true, currentVersionId: true },
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

  /** The same rule the form shows live, so a draw never refuses something the screen called ready. */
  private assertBankCanFill(
    sections: BaseConfigDetail['sections'],
    spec: DrawSpec | null,
    pool: readonly DrawCandidate[],
  ): void {
    const gaps = paperFeasibility(
      sections.map(toFeasibilitySection),
      spec,
      availabilityOf(sections, spec, pool),
    );
    if (gaps.length === 0) return;

    throw new AppException(
      ErrorCodes.DRAW_SHORTFALL,
      'The bank does not hold enough questions to fill every section of this paper.',
      { fieldErrors: shortfallErrors(gaps) },
    );
  }

  private assertAssemblable(test: { attemptCount: number; paperBinding: string }): void {
    if (test.attemptCount > 0) {
      throw new AppException(ErrorCodes.CONFLICT, SAT_TEST_MESSAGE, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [SAT_TEST_MESSAGE] },
      });
    }
    if (test.paperBinding === PAPER_BINDING.GENERATED) {
      throw new AppException(ErrorCodes.CONFLICT, GENERATED_HAS_NO_PAPER_MESSAGE, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [GENERATED_HAS_NO_PAPER_MESSAGE] },
      });
    }
  }

  /** One paper at a time. A FIXED test has only variant 0; a GENERATED one is read a variant at a time. */
  private async paperOf(
    testId: string,
    config: BaseConfigDetail,
    variant = FIXED_VARIANT,
  ): Promise<TestPaper> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId, variant },
      include: PAPER_INCLUDE,
      orderBy: { order: 'asc' },
    });

    return {
      testId,
      totalQuestions: rows.length,
      sections: config.sections.map((section) => ({
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
            variant: row.variant,
            order: row.order,
            marks: Number(row.marks),
            negativeMarks: Number(row.negativeMarks),
            status: row.status,
            question: row.question,
          })),
      })),
    };
  }

  private async requireTest(id: string) {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: {
        id: true,
        baseConfigId: true,
        isLocked: true,
        paperBinding: true,
        drawStrategy: true,
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

function toFeasibilitySection(section: BaseConfigDetail['sections'][number]): FeasibilitySection {
  return { id: section.id, name: section.name, questionCount: section.questionCount };
}

/** What the pool actually holds per section, once that section's own subject and topics apply. */
function availabilityOf(
  sections: BaseConfigDetail['sections'],
  spec: DrawSpec | null,
  pool: readonly DrawCandidate[],
): Record<string, SectionAvailability> {
  return Object.fromEntries(
    sections.map((section) => {
      const topicIds = spec?.sections?.[section.id]?.topicIds;
      const held = pool.filter(
        (candidate) =>
          (section.subjectId === null || candidate.subjectId === section.subjectId) &&
          (!topicIds?.length ||
            (candidate.topicId !== null && topicIds.includes(candidate.topicId))),
      );

      const byDifficulty: SectionAvailability['byDifficulty'] = {};
      for (const candidate of held) {
        byDifficulty[candidate.difficulty] = (byDifficulty[candidate.difficulty] ?? 0) + 1;
      }
      return [section.id, { total: held.length, byDifficulty }];
    }),
  );
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
    createdAt: row.createdAt,
    fixedUseCount: row.fixedUseCount,
  };
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
