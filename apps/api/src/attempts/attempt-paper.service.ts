import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  contentLanguageOf,
  type ExamOption,
  type ExamPaper,
  type ExamQuestion,
  type LanguageCode,
  type LocalizedContent,
  type LocalizedRich,
  type QuestionOption,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

const PAPER_INCLUDE = {
  test: {
    select: {
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
  constructor(private readonly prisma: PrismaService) {}

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
      languages,
      languageMode: config.languageMode,
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
      questions: attempt.questions.map((row) =>
        toExamQuestion(row, languages, config.shuffleOptions, random),
      ),
    };
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
