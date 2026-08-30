/**
 * What a student is shown about a sitting they have finished. TWO reads live here and they are not
 * the same: the score card's select never loads `questionVersion`, so no key can reach it; the
 * review's does, and is reachable only past `solutionsAreOpen`. Keep them that way.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  contentLanguageOf,
  type AnswerKey,
  type LanguageCode,
  type LocalizedContent,
  type QuestionOption,
  type ScoreCard,
  type ScoreCardQuestion,
  type SolutionQuestion,
  type SolutionReport,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService, type TestSchedule } from '../access';
import { StorageService } from '../storage/storage.service';
import { imageUrlsIn } from './exam-images';
import { htmlIn, narrowRich, signLocalizedRich, signRich } from './exam-content';
import { seededRandom, shuffle } from '../common/seeded-shuffle';
import { solutionsAreOpen, solutionsClosedReason, solutionsOpenAt } from './solution-gate';
import { sectionScoresIn } from './score-paper';
import { LeaderboardService } from './leaderboard.service';
import {
  elapsedSeconds,
  isProvisional,
  lastSittingEndsAt,
  marksBySection,
  percentageOf,
  sectionsWithScores,
} from './attempt-report';

const NOT_YOURS = 'No such sitting';
const NOT_REVIEWABLE = 'This paper has not been marked yet, so there is nothing to review.';
const NOT_MARKED = 'This paper has not been marked yet. Its score card opens the moment it is.';

const SCORE_CARD_SELECT = {
  id: true,
  testId: true,
  attemptNo: true,
  isGraded: true,
  status: true,
  startedAt: true,
  submittedAt: true,
  evaluatedAt: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  unattemptedCount: true,
  sectionScores: true,
  lastRank: true,
  lastPercentile: true,
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
          durationSec: true,
          totalQuestions: true,
          sections: {
            select: {
              id: true,
              name: true,
              order: true,
              questionCount: true,
              marksPerQuestion: true,
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
      state: true,
      selectedOptionId: true,
      typedAnswer: true,
      isCorrect: true,
      marksAwarded: true,
      timeSpentSec: true,
      paperItem: { select: { marks: true, negativeMarks: true, status: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

/** What the GATE needs, and nothing else — this read happens before anybody has been let in. */
const GATE_SELECT = {
  id: true,
  testId: true,
  status: true,
  test: { select: { evaluationMode: true, baseConfig: { select: { durationSec: true } } } },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. Reached only past `solutionsAreOpen`, which is why it is a second read and not a join. */
const SOLUTION_SELECT = {
  id: true,
  testId: true,
  languages: true,
  shuffleSeed: true,
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
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
      ...SCORE_CARD_SELECT.questions.select,
      question: { select: { type: true } },
      questionVersion: { select: { content: true, options: true, answerKey: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

type ScoreCardRow = Prisma.AttemptGetPayload<{ select: typeof SCORE_CARD_SELECT }>;
type GateRow = Prisma.AttemptGetPayload<{ select: typeof GATE_SELECT }>;
type SolutionRow = Prisma.AttemptGetPayload<{ select: typeof SOLUTION_SELECT }>;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly leaderboard: LeaderboardService,
    private readonly storage: StorageService,
  ) {}

  async scoreCard(
    studentId: string,
    attemptId: string,
    now: Date = new Date(),
  ): Promise<ScoreCard> {
    const attempt = await this.require(studentId, attemptId);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const config = attempt.test.baseConfig;
    const questions = attempt.questions.map(toScoreCardQuestion);
    const perSection = marksBySection(questions);

    // Finality is not one branch's business: while ANY branch can still let somebody in, it moves.
    const schedule = await this.access.testSchedule(attempt.testId);
    const endsAt = lastSittingEndsAt(schedule.closesAt, config.durationSec, schedule.extraTimeSec);
    const standing = await this.leaderboard.liveStanding(attempt.testId, attempt.id);
    const score = Number(attempt.score ?? 0);
    const maxMarks = round([...perSection.values()].reduce((sum, marks) => sum + marks, 0));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      attemptNo: attempt.attemptNo,
      isGraded: attempt.isGraded,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      evaluatedAt: attempt.evaluatedAt?.toISOString() ?? null,
      score,
      maxMarks,
      percentage: percentageOf(score, maxMarks),
      correctCount: attempt.correctCount ?? 0,
      wrongCount: attempt.wrongCount ?? 0,
      unattemptedCount: attempt.unattemptedCount ?? 0,
      totalQuestions: config.totalQuestions,
      timeTakenSec:
        attempt.submittedAt === null ? 0 : elapsedSeconds(attempt.startedAt, attempt.submittedAt),
      durationSec: config.durationSec,
      // The snapshot only where the live board could not answer, so a screen is never blank.
      rank: standing?.rank ?? attempt.lastRank,
      percentile: standing?.percentile ?? numberOrNull(attempt.lastPercentile),
      cohortSize: standing?.cohortSize ?? null,
      provisional: isProvisional(endsAt, now),
      sections: sectionsWithScores(
        config.sections.map((section) => ({
          ...section,
          marksPerQuestion: Number(section.marksPerQuestion),
        })),
        sectionScoresIn(attempt.sectionScores),
        perSection,
      ),
      questions,
    };
  }

  /** The answer key, once and only once the gate has opened. Two reads, so a refusal never held it. */
  async solutions(
    studentId: string,
    attemptId: string,
    now: Date = new Date(),
  ): Promise<SolutionReport> {
    const gate = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: GATE_SELECT,
    });
    if (!gate) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (gate.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    const facts = gateFacts(gate, await this.access.testSchedule(gate.testId));
    // The key has not been fetched yet, so a refusal here cannot be carrying a fragment of it.
    if (!solutionsAreOpen(facts, now)) {
      throw new AppException(ErrorCodes.FORBIDDEN, solutionsClosedReason(facts));
    }

    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SOLUTION_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    // The same seed the exam used, so the option they remember as "C" is "C" in the review too.
    const random = seededRandom(attempt.shuffleSeed);
    const shuffleOptions = attempt.test.baseConfig.shuffleOptions;
    const questions = attempt.questions.map((row) =>
      toSolutionQuestion(row, attempt.languages, shuffleOptions, random),
    );
    const urls = await imageUrlsIn(this.storage, questions.flatMap(htmlOf));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      languages: attempt.languages,
      openedAt: solutionsOpenAt(facts),
      sections: attempt.test.baseConfig.sections.map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: urls.size === 0 ? questions : questions.map((row) => signed(row, urls)),
    };
  }

  /** The owner is part of the QUERY, so another student's sitting reads as missing, not refused. */
  private async require(studentId: string, attemptId: string): Promise<ScoreCardRow> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SCORE_CARD_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    return attempt;
  }
}

function toScoreCardQuestion(row: ScoreCardRow['questions'][number]): ScoreCardQuestion {
  return {
    questionId: row.questionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    state: row.state,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    isCorrect: row.isCorrect,
    marksAwarded: numberOrNull(row.marksAwarded),
    marks: Number(row.paperItem?.marks ?? 0),
    negativeMarks: Number(row.paperItem?.negativeMarks ?? 0),
    disposition: row.paperItem?.status ?? PAPER_QUESTION_STATUS.ACTIVE,
    timeSpentSec: row.timeSpentSec,
  };
}

const numberOrNull = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

const round = (value: number) => Math.round(value * 100) / 100;

function gateFacts(attempt: GateRow, schedule: TestSchedule) {
  return {
    evaluationMode: attempt.test.evaluationMode,
    scheduled: schedule.scheduled,
    closesAt: schedule.closesAt,
    durationSec: attempt.test.baseConfig.durationSec,
    extraTimeSec: schedule.extraTimeSec,
  };
}

function toSolutionQuestion(
  row: SolutionRow['questions'][number],
  languages: readonly LanguageCode[],
  shuffleOptions: boolean,
  random: () => number,
): SolutionQuestion {
  const stored = (row.questionVersion.options as QuestionOption[] | null) ?? [];
  const options = stored.map((option) => ({ ...option, text: narrowRich(option.text, languages) }));
  return {
    ...toScoreCardQuestion(row),
    type: row.question.type,
    content: narrowContent(row.questionVersion.content as LocalizedContent | null, languages),
    options: shuffleOptions ? shuffle(options, random) : options,
    answerKey: (row.questionVersion.answerKey as AnswerKey | null) ?? null,
  };
}

/** Stem AND solution, unlike the exam paper — explaining the answer is the whole point here. */
function narrowContent(
  content: LocalizedContent | null,
  languages: readonly LanguageCode[],
): LocalizedContent {
  const kept: LocalizedContent = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = content?.[key];
    if (held) kept[key] = held;
  }
  return kept;
}

/** Every piece of HTML one reviewed question carries — stem, solution and every option. */
function htmlOf(question: SolutionQuestion): string[] {
  const content = Object.values(question.content).flatMap((held) => [
    ...htmlIn(held?.stem),
    ...htmlIn(held?.solution),
  ]);
  const options = question.options.flatMap((option) =>
    Object.values(option.text).flatMap((nodes) => htmlIn(nodes)),
  );
  return [...content, ...options];
}

function signed(question: SolutionQuestion, urls: ReadonlyMap<string, string>): SolutionQuestion {
  return {
    ...question,
    content: Object.fromEntries(
      Object.entries(question.content).map(([language, held]) => [
        language,
        // `solution` is optional, so it is added back only where there was one to sign.
        held
          ? {
              stem: signRich(held.stem, urls),
              ...(held.solution ? { solution: signRich(held.solution, urls) } : {}),
            }
          : held,
      ]),
    ),
    options: question.options.map((option) => ({
      ...option,
      text: signLocalizedRich(option.text, urls),
    })),
  };
}
