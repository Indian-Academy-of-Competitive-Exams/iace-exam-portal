import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  scopedSections,
  scopedDurationSec,
  type ExamOption,
  type ExamBrief,
  type ExamPaper,
  type ExamQuestion,
  type LanguageCode,
  type LocalizedContent,
  type QuestionOption,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { displayOrder } from './attempt-rules';
import { imageUrlsIn } from './exam-images';
import { htmlOfQuestion, narrowTo, signedQuestion } from './exam-content';
import { StorageService } from '../storage/storage.service';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

/** Named field by field, never `include`: the sitting's own scored columns never load at all. */
const PAPER_SELECT = {
  id: true,
  testId: true,
  endsAt: true,
  languages: true,
  shuffleSeed: true,
  test: {
    select: {
      examTemplate: true,
      scope: true,
      scopeRef: true,
      baseConfig: {
        select: {
          defaultTestUi: true,
          languageMode: true,
          timerTemplate: true,
          navigation: true,
          calculatorEnabled: true,
          shuffleOptions: true,
          shuffleQuestions: true,
          sections: {
            select: {
              id: true,
              moduleId: true,
              name: true,
              order: true,
              questionCount: true,
              durationSec: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
} as const satisfies Prisma.AttemptSelect;

/** `answerKey` never loads; `content` and `options` are whole JSON, so the mappers below strip them. */
const EXAM_ROW_SELECT = {
  questionId: true,
  baseConfigSectionId: true,
  marks: true,
  negativeMarks: true,
  question: { select: { type: true } },
  questionVersion: { select: { content: true, options: true } },
} as const satisfies Prisma.PaperQuestionSelect;

type ServedQuestion = Prisma.PaperQuestionGetPayload<{ select: typeof EXAM_ROW_SELECT }> & {
  order: number;
};

/** The paper as a candidate sees it. Nothing it returns may say what the answers are. */
@Injectable()
export class AttemptPaperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly storage: StorageService,
  ) {}

  /** Gated on REACH, not on the window: a test they cannot sit yet is one they may read about. */
  async brief(studentId: string, testId: string): Promise<ExamBrief> {
    await this.access.assertReachable(studentId, testId);

    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        title: true,
        scope: true,
        scopeRef: true,
        baseConfig: {
          select: {
            durationSec: true,
            totalQuestions: true,
            languageMode: true,
            languages: true,
            sections: {
              select: {
                id: true,
                moduleId: true,
                name: true,
                questionCount: true,
                durationSec: true,
                perQuestionSec: true,
                marksPerQuestion: true,
                negativeMarks: true,
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');

    // A scoped test sits its own sections; the rest belong to other tests on the same configuration.
    const covered = scopedSections(
      test.baseConfig.sections,
      test.scope,
      (test.scopeRef as TestScopeRef | null) ?? null,
    );

    return {
      testId: test.id,
      title: test.title,
      durationSec: scopedDurationSec(
        test.baseConfig.sections,
        test.baseConfig,
        test.scope,
        (test.scopeRef as TestScopeRef | null) ?? null,
      ),
      totalQuestions: covered.reduce((total, section) => total + section.questionCount, 0),
      languageMode: test.baseConfig.languageMode,
      languages: test.baseConfig.languages,
      sections: covered.map((section) => ({
        id: section.id,
        name: section.name,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
        marksPerQuestion: Number(section.marksPerQuestion),
        negativeMarks: Number(section.negativeMarks),
      })),
    };
  }

  async paper(studentId: string, attemptId: string): Promise<ExamPaper> {
    // The owner is part of the QUERY, so serving someone else's paper is not a check to forget.
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: PAPER_SELECT,
    });
    // NOT_FOUND, never FORBIDDEN: an id is not a thing to confirm the existence of.
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, 'No such sitting');

    const config = attempt.test.baseConfig;
    const languages = attempt.languages;
    const random = seededRandom(attempt.shuffleSeed);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: 'asc' },
      select: EXAM_ROW_SELECT,
    });
    const served = displayOrder(rows, attempt.shuffleSeed, config.shuffleQuestions);

    return {
      attemptId: attempt.id,
      endsAt: attempt.endsAt.toISOString(),
      serverNow: new Date().toISOString(),
      languages,
      languageMode: config.languageMode,
      examTemplate: attempt.test.examTemplate,
      testUi: config.defaultTestUi,
      timerTemplate: config.timerTemplate,
      navigation: config.navigation,
      calculatorEnabled: config.calculatorEnabled,
      sections: scopedSections(
        config.sections,
        attempt.test.scope,
        (attempt.test.scopeRef as TestScopeRef | null) ?? null,
      ).map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: await this.withImages(
        served.map((row, index) =>
          toExamQuestion({ ...row, order: index + 1 }, languages, config.shuffleOptions, random),
        ),
      ),
    };
  }

  /** Content on disk holds only the image KEY, so the sitting signs its own, long enough to last. */
  private async withImages(questions: ExamQuestion[]): Promise<ExamQuestion[]> {
    const urls = await imageUrlsIn(this.storage, questions.flatMap(htmlOfQuestion));
    return urls.size === 0
      ? questions
      : questions.map((question) => signedQuestion(question, urls));
  }
}

function toExamQuestion(
  row: ServedQuestion,
  languages: readonly LanguageCode[],
  shuffleOptions: boolean,
  random: () => number,
): ExamQuestion {
  const options = (row.questionVersion.options as QuestionOption[] | null) ?? [];
  const visible = options.map((option) => toExamOption(option, languages));

  return {
    questionId: row.questionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    type: row.question.type,
    marks: Number(row.marks),
    negativeMarks: Number(row.negativeMarks),
    // The STEM only: `solution` explains the answer, so it stays behind.
    content: narrowTo(
      row.questionVersion.content as LocalizedContent | null,
      languages,
      (held) => ({ stem: held.stem }),
    ),
    options: shuffleOptions ? shuffle(visible, random) : visible,
  };
}

/** The id travels, so a shuffled option still scores; `isCorrect` is dropped and never rebuilt. */
function toExamOption(option: QuestionOption, languages: readonly LanguageCode[]): ExamOption {
  return {
    id: option.id,
    position: option.position,
    text: narrowTo(option.text, languages),
  };
}
