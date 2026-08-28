import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  contentLanguageOf,
  type ExamOption,
  type ExamBrief,
  type ExamPaper,
  type ExamQuestion,
  type LanguageCode,
  type LocalizedContent,
  type LocalizedRich,
  type QuestionOption,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { applyImageUrls, imageKeysIn } from '../questions';
import { StorageService } from '../storage/storage.service';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

const PAPER_INCLUDE = {
  test: {
    select: {
      examTemplate: true,
      baseConfig: {
        select: {
          languageMode: true,
          timerTemplate: true,
          navigation: true,
          calculatorEnabled: true,
          shuffleOptions: true,
          sections: {
            select: {
              id: true,
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
  questions: {
    select: {
      questionId: true,
      order: true,
      baseConfigSectionId: true,
      question: { select: { type: true } },
      questionVersion: { select: { content: true, options: true } },
      paperItem: { select: { marks: true, negativeMarks: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptInclude;

type PaperRow = Prisma.AttemptGetPayload<{ include: typeof PAPER_INCLUDE }>;
type ServedQuestion = PaperRow['questions'][number];

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
        baseConfig: {
          select: {
            durationSec: true,
            totalQuestions: true,
            languageMode: true,
            languages: true,
            sections: {
              select: {
                id: true,
                name: true,
                questionCount: true,
                durationSec: true,
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

    return {
      testId: test.id,
      title: test.title,
      durationSec: test.baseConfig.durationSec,
      totalQuestions: test.baseConfig.totalQuestions,
      languageMode: test.baseConfig.languageMode,
      languages: test.baseConfig.languages,
      sections: test.baseConfig.sections.map((section) => ({
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
      include: PAPER_INCLUDE,
    });
    // NOT_FOUND, never FORBIDDEN: an id is not a thing to confirm the existence of.
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, 'No such sitting');

    const config = attempt.test.baseConfig;
    const languages = attempt.languages;
    const random = seededRandom(attempt.shuffleSeed);

    return {
      attemptId: attempt.id,
      endsAt: attempt.endsAt.toISOString(),
      serverNow: new Date().toISOString(),
      languages,
      languageMode: config.languageMode,
      examTemplate: attempt.test.examTemplate,
      timerTemplate: config.timerTemplate,
      navigation: config.navigation,
      calculatorEnabled: config.calculatorEnabled,
      sections: config.sections.map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: await this.withImages(
        attempt.questions.map((row) =>
          toExamQuestion(row, languages, config.shuffleOptions, random),
        ),
      ),
    };
  }

  /** Content on disk holds only the image KEY, so the sitting signs its own, long enough to last. */
  private async withImages(questions: ExamQuestion[]): Promise<ExamQuestion[]> {
    const keys = new Set(questions.flatMap(htmlOf).flatMap(imageKeysIn));
    if (keys.size === 0) return questions;

    const urls = new Map(
      await Promise.all(
        [...keys].map(
          async (key) =>
            [key, await this.storage.createDownloadUrl(key, EXAM_IMAGE_URL_TTL_SEC)] as const,
        ),
      ),
    );
    return questions.map((question) => signed(question, urls));
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
    marks: Number(row.paperItem?.marks ?? 0),
    negativeMarks: Number(row.paperItem?.negativeMarks ?? 0),
    content: narrowContent(row.questionVersion.content as LocalizedContent | null, languages),
    options: shuffleOptions ? shuffle(visible, random) : visible,
  };
}

/** The id travels, so a shuffled option still scores; `isCorrect` is dropped and never rebuilt. */
function toExamOption(option: QuestionOption, languages: readonly LanguageCode[]): ExamOption {
  return {
    id: option.id,
    position: option.position,
    text: narrowRich(option.text, languages),
  };
}

/** The STEM only, in this sitting's languages. `solution` explains the answer, so it stays behind. */
function narrowContent(
  content: LocalizedContent | null,
  languages: readonly LanguageCode[],
): LocalizedContent {
  const kept: LocalizedContent = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = content?.[key];
    if (held) kept[key] = { stem: held.stem };
  }
  return kept;
}

function narrowRich(text: LocalizedRich, languages: readonly LanguageCode[]): LocalizedRich {
  const kept: LocalizedRich = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = text?.[key];
    if (held) kept[key] = held;
  }
  return kept;
}

/** Longer than the longest sitting: an image that expires mid-exam is a question nobody can read. */
const EXAM_IMAGE_URL_TTL_SEC = 6 * 60 * 60;

/** Every piece of HTML one served question carries — its stem and every option, in every language. */
function htmlOf(question: ExamQuestion): string[] {
  const stems = Object.values(question.content).flatMap((content) =>
    (content?.stem ?? []).map((node) => node.text),
  );
  const options = question.options.flatMap((option) =>
    Object.values(option.text).flatMap((nodes) => (nodes ?? []).map((node) => node.text)),
  );
  return [...stems, ...options];
}

function signed(question: ExamQuestion, urls: ReadonlyMap<string, string>): ExamQuestion {
  const rich = (nodes: { type: 'TEXT'; text: string }[] | undefined) =>
    (nodes ?? []).map((node) => ({ ...node, text: applyImageUrls(node.text, urls) }));

  return {
    ...question,
    content: Object.fromEntries(
      Object.entries(question.content).map(([language, content]) => [
        language,
        content ? { ...content, stem: rich(content.stem) } : content,
      ]),
    ),
    options: question.options.map((option) => ({
      ...option,
      text: Object.fromEntries(
        Object.entries(option.text).map(([language, nodes]) => [language, rich(nodes)]),
      ),
    })),
  };
}
