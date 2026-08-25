import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  QUESTION_STATUS,
  type AssemblePaperBody,
  type BaseConfigDetail,
  type ManualSectionPick,
  type QuestionPoolFilter,
  type TestPaper,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { BaseConfigsService } from '../configs';
import {
  drawPaper,
  manualPickIssues,
  type DrawCandidate,
  type DrawSection,
  type DrawnQuestion,
} from './draw-engine';
import { SAT_TEST_MESSAGE } from './test-rules';
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
  'This test draws a fresh paper for each student, so there is no one paper to assemble. Switch it to a fixed paper first.';

/** Assembles a DRAFT test's paper — drawn, hand-picked, or both. Finalize is what freezes it. */
@Injectable()
export class PaperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: BaseConfigsService,
  ) {}

  async read(testId: string): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    const config = await this.configs.detail(test.baseConfigId);
    return this.paperOf(test.id, config);
  }

  async assemble(testId: string, input: AssemblePaperBody): Promise<TestPaper> {
    const test = await this.requireTest(testId);
    this.assertAssemblable({ ...test, attemptCount: test._count.attempts });

    const config = await this.configs.detail(test.baseConfigId);
    const sections = config.sections.map(toDrawSection);
    const filter = (test.questionPoolFilter as QuestionPoolFilter | null) ?? null;

    const pinned = await this.resolvePicks(input.manual ?? []);
    this.assertPicksFit(sections, pinned);

    const result = drawPaper({
      sections,
      pool: await this.poolFor(sections, filter),
      strategy: test.drawStrategy,
      filter,
      seed: input.seed ?? freshSeed(),
      pinned,
    });

    if (!result.ok) {
      throw new AppException(
        ErrorCodes.DRAW_SHORTFALL,
        'The bank does not hold enough questions to fill every section of this paper.',
        {
          fieldErrors: Object.fromEntries(
            result.shortfalls.map((gap) => [
              gap.baseConfigSectionId,
              [`${gap.sectionName} needs ${gap.needed}, and only ${gap.available} are available.`],
            ]),
          ),
        },
      );
    }

    await this.replacePaper(test, result.questions);

    return this.paperOf(test.id, config);
  }

  /** Replaced wholesale: a re-draw is a new paper, not a merge into rows nobody can see. */
  private async replacePaper(
    test: { id: string; baseConfigId: string; isLocked: boolean },
    questions: readonly DrawnQuestion[],
  ): Promise<void> {
    const { id: testId, baseConfigId } = test;
    await this.prisma.$transaction(async (tx) => {
      // First: it reads the paper it is giving the counts back for, and this replaces that paper.
      await thaw(tx, test);
      await tx.paperQuestion.deleteMany({ where: { testId } });
      await tx.paperQuestion.createMany({
        data: questions.map((row) => ({ ...row, testId, baseConfigId })),
      });
    });
  }

  /** Only ACTIVE questions carrying a current version: a paper pins a version, so there must be one. */
  private async poolFor(
    sections: readonly DrawSection[],
    filter: QuestionPoolFilter | null,
  ): Promise<DrawCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        status: QUESTION_STATUS.ACTIVE,
        currentVersionId: { not: null },
        ...subjectWhere(sections),
        ...poolWhere(filter),
      },
      select: CANDIDATE_SELECT,
    });
    return rows.filter(hasVersion).map(toCandidate);
  }

  /** A hand-pick overrides the pool filter: the admin chose this question, not a description of one. */
  private async resolvePicks(
    picks: readonly ManualSectionPick[],
  ): Promise<Map<string, DrawCandidate[]>> {
    const wanted = [...new Set(picks.flatMap((pick) => pick.questionIds))];
    if (wanted.length === 0) return new Map();

    const rows = await this.prisma.question.findMany({
      where: {
        id: { in: wanted },
        status: QUESTION_STATUS.ACTIVE,
        currentVersionId: { not: null },
      },
      select: CANDIDATE_SELECT,
    });
    const byId = new Map(rows.filter(hasVersion).map((row) => [row.id, toCandidate(row)]));

    const missing = wanted.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const message = `${missing.length} of the chosen questions are no longer in the bank, or have no published version.`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { manual: [message] },
      });
    }

    // Accumulated, not keyed: two picks for one section are the admin's, not a row to drop.
    const chosen = new Map<string, DrawCandidate[]>();
    for (const pick of picks) {
      const held = chosen.get(pick.baseConfigSectionId) ?? [];
      held.push(...pick.questionIds.map((id) => byId.get(id)!));
      chosen.set(pick.baseConfigSectionId, held);
    }
    return chosen;
  }

  private assertPicksFit(
    sections: readonly DrawSection[],
    pinned: ReadonlyMap<string, readonly DrawCandidate[]>,
  ): void {
    const issues = manualPickIssues(sections, pinned);
    if (issues.length === 0) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, issues[0]!, {
      fieldErrors: { manual: issues },
    });
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

  private async paperOf(testId: string, config: BaseConfigDetail): Promise<TestPaper> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
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
function poolWhere(filter: QuestionPoolFilter | null): Prisma.QuestionWhereInput {
  if (!filter) return {};
  return {
    ...(filter.subjectIds?.length ? { subjectId: { in: filter.subjectIds } } : {}),
    ...(filter.topicIds?.length ? { topicId: { in: filter.topicIds } } : {}),
    ...(filter.difficulties?.length ? { difficulty: { in: filter.difficulties } } : {}),
    ...(filter.tags?.length ? { tags: { hasSome: filter.tags } } : {}),
  };
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
