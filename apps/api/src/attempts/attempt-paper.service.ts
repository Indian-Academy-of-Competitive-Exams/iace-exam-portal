import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  optionLetter,
  scopedSections,
  servedQuestions,
  scopedDurationSec,
  scopedQuestionCount,
  type ExamOption,
  type ExamBrief,
  type ExamPaper,
  type SharedPaper,
  type ExamQuestion,
  type LanguageCode,
  type LocalizedContent,
  type PrintablePaper,
  type PrintablePaperQuery,
  type QuestionOption,
  languagesFor,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { imageUrlsIn } from './exam-images';
import { htmlOfQuestion, narrowTo, servedQuestion } from './exam-content';
import { StorageService } from '../storage/storage.service';
import { PaperSheetService, recall, remember, type ServedPaperRow } from './paper-sheet.service';
import { optionsIn, scopeRefOf } from '../common/prisma-json';

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
          languages: true,
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

/** What a printed paper says of itself above its first question. */
const PRINT_CARD_SELECT = {
  title: true,
  testSeries: { select: { name: true } },
  baseConfig: {
    select: {
      durationSec: true,
      totalQuestions: true,
      sections: {
        select: {
          id: true,
          moduleId: true,
          questionCount: true,
          durationSec: true,
          perQuestionSec: true,
        },
      },
    },
  },
} as const satisfies Prisma.TestSelect;

/** PAPER_SELECT's test half, reachable without a sitting — the shared paper has no attempt to read. */
const TEST_PAPER_SELECT = PAPER_SELECT.test.select;

type ServedQuestion = ServedPaperRow & { order: number };

type PaperTest = Prisma.TestGetPayload<{ select: typeof TEST_PAPER_SELECT }>;

/** The paper as a candidate sees it. Nothing it returns may say what the answers are. */
@Injectable()
export class AttemptPaperService {
  private readonly tests = new Map<string, { epoch: number; test: Promise<PaperTest> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly storage: StorageService,
    private readonly papers: PaperSheetService,
  ) {}

  /** Gated on REACH, not on the window: a test they cannot sit yet is one they may read about. */
  async brief(studentId: string, testId: string): Promise<ExamBrief> {
    const test = await this.access.reachableTest(studentId, testId);

    const scopeRef = scopeRefOf(test);
    // A scoped test sits its own sections; the rest belong to other tests on the same configuration.
    const covered = scopedSections(test.baseConfig.sections, test.scope, scopeRef);

    return {
      testId: test.id,
      title: test.title,
      examTemplate: test.examTemplate,
      navigation: test.baseConfig.navigation,
      durationSec: scopedDurationSec(
        test.baseConfig.sections,
        test.baseConfig,
        test.scope,
        scopeRef,
      ),
      totalQuestions: scopedQuestionCount(test.baseConfig.sections, test.scope, scopeRef),
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

  /** One test's paper, in PAPER order and unshuffled, held before any sitting of it exists. */
  async testPaper(
    studentId: string,
    testId: string,
    picked: readonly LanguageCode[] | undefined,
  ): Promise<SharedPaper> {
    // The same gate a start passes, so holding the paper and beginning are open at the same instant.
    await this.access.assertCanStart(studentId, testId);

    const test = await this.testOf(testId);

    const config = test.baseConfig;
    return {
      ...(await this.shapeOf(
        test,
        testId,
        languagesFor(config.languageMode, config.languages, picked),
      )),
      shuffleQuestions: config.shuffleQuestions,
      shuffleOptions: config.shuffleOptions,
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
    const shared = await this.shapeOf(attempt.test, attempt.testId, attempt.languages);

    return {
      ...shared,
      attemptId: attempt.id,
      endsAt: attempt.endsAt.toISOString(),
      serverNow: new Date().toISOString(),
      questions: servedQuestions(
        shared.questions,
        attempt.shuffleSeed,
        config.shuffleQuestions,
        config.shuffleOptions,
      ),
    };
  }

  /** Held on the catalog's own counter, which every write that could move this row already bumps. */
  private async testOf(testId: string): Promise<PaperTest> {
    const epoch = await this.access.catalogEpoch();
    const held = recall(this.tests, testId);
    if (held?.epoch === epoch) return held.test;

    const next = { epoch, test: this.requireTest(testId) };
    remember(this.tests, testId, next);
    // Not held once it fails, so the next reader retries instead of inheriting the failure.
    next.test.catch(() => {
      if (this.tests.get(testId) === next) this.tests.delete(testId);
    });
    return next.test;
  }

  private async requireTest(testId: string): Promise<PaperTest> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: TEST_PAPER_SELECT,
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }

  /** The whole paper to print, read fresh so a draft prints as it stands and leaves no held copy behind. */
  async printable(testId: string, query: PrintablePaperQuery): Promise<PrintablePaper> {
    const [test, card, rows] = await Promise.all([
      this.requireTest(testId),
      this.prisma.test.findUnique({ where: { id: testId }, select: PRINT_CARD_SELECT }),
      this.papers.servedNow(testId),
    ]);
    if (!card) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');

    const available = test.baseConfig.languages as LanguageCode[];
    const asked = (query.languages ?? []).filter((language) => available.includes(language));
    const languages = asked.length > 0 ? asked : available;
    const shared = await this.shapeOf(test, testId, languages, rows);

    return {
      testId,
      title: card.title,
      series: card.testSeries.name,
      languages,
      available,
      durationSec: scopedDurationSec(
        card.baseConfig.sections,
        card.baseConfig,
        test.scope,
        scopeRefOf(test),
      ),
      maxMarks: shared.questions.reduce((total, question) => total + question.marks, 0),
      sections: shared.sections,
      questions: shared.questions,
      answerKey: query.answerKey ? await this.keyOf(testId, shared.questions) : null,
    };
  }

  /** Each answer by the letter its option is printed under, off the terms the scorer marks against. */
  private async keyOf(
    testId: string,
    questions: readonly ExamQuestion[],
  ): Promise<PrintablePaper['answerKey']> {
    const terms = new Map(
      (await this.papers.termsNow(testId)).map((term) => [term.questionId, term]),
    );
    return questions.flatMap((question) => {
      const term = terms.get(question.questionId);
      if (!term) return [];
      const letters = question.options
        .flatMap((option, place) =>
          term.correctOptionIds.includes(option.id) ? [optionLetter(place)] : [],
        )
        .join(', ');
      const typed = Object.values(term.answerKey?.answers ?? {}).find(
        (answer) => typeof answer === 'string',
      );
      const answer = letters || typed;
      return answer ? [{ questionId: question.questionId, answer }] : [];
    });
  }

  /** Everything a paper is before a sitting narrows it: sections, questions, and how it is drawn. */
  private async shapeOf(
    test: PaperTest,
    testId: string,
    languages: readonly LanguageCode[],
    held?: ServedPaperRow[],
  ): Promise<SharedPaper> {
    const config = test.baseConfig;
    const rows = held ?? (await this.papers.servedOf(testId));

    return {
      languages: [...languages],
      languageMode: config.languageMode,
      examTemplate: test.examTemplate,
      testUi: config.defaultTestUi,
      timerTemplate: config.timerTemplate,
      navigation: config.navigation,
      calculatorEnabled: config.calculatorEnabled,
      shuffleQuestions: config.shuffleQuestions,
      shuffleOptions: config.shuffleOptions,
      sections: scopedSections(config.sections, test.scope, scopeRefOf(test)).map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: this.withImages(
        rows.map((row, index) => toExamQuestion({ ...row, order: index + 1 }, languages)),
      ),
    };
  }

  /** Content on disk holds only the image KEY, so the sitting resolves each to its media url. */
  private withImages(questions: ExamQuestion[]): ExamQuestion[] {
    const urls = imageUrlsIn(this.storage, questions.flatMap(htmlOfQuestion));
    return questions.map((question) => servedQuestion(question, urls));
  }
}

function toExamQuestion(row: ServedQuestion, languages: readonly LanguageCode[]): ExamQuestion {
  const options = optionsIn(row.questionVersion.options);
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
    options: visible,
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
