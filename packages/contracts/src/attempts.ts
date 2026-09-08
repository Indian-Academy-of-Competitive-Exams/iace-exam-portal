import { z } from 'zod';
import { languageCodeSchema } from './exams';
import {
  examTemplateSchema,
  languageModeSchema,
  navigationPolicySchema,
  testUiSchema,
  timerTemplateSchema,
} from './configs';
import {
  answerKeySchema,
  localizedContentSchema,
  localizedRichSchema,
  questionOptionSchema,
  questionTypeSchema,
} from './questions';
import { evaluationModeSchema, paperQuestionStatusSchema } from './tests';

// ============================================================================
// Attempts. One row holds the live state and the scored result — there is no
// separate result. Live rank and percentile are read from Redis; what is here
// is the last persisted snapshot.
// ============================================================================

export const ATTEMPT_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  EVALUATED: 'EVALUATED',
  EXPIRED: 'EXPIRED',
} as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUS);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

/** What the palette shows for a question, and what the engine writes back. */
export const ANSWER_STATE = {
  NOT_VISITED: 'NOT_VISITED',
  NOT_ANSWERED: 'NOT_ANSWERED',
  ANSWERED: 'ANSWERED',
  MARKED_REVIEW: 'MARKED_REVIEW',
  ANSWERED_MARKED: 'ANSWERED_MARKED',
} as const;
export const answerStateSchema = z.enum(ANSWER_STATE);
export type AnswerState = z.infer<typeof answerStateSchema>;
export const ANSWER_STATES = answerStateSchema.options;

/** How full an OMR bubble is, as an answer state. The fill is never stored — it is derived from one. */
export const OMR_FILL = {
  /** Below this a press is a smudge: a stray tap must not flag a question nobody engaged with. */
  MIN: 0.15,
  /** What a half-filled bubble redraws at. One value, so 40% and 70% are the same commitment. */
  PARTIAL: 0.5,
  /** Committed, and past the point the student may take it back. */
  FULL: 1,
} as const;

export function omrStateFor(fill: number): AnswerState {
  if (fill >= OMR_FILL.FULL) return ANSWER_STATE.ANSWERED;
  if (fill >= OMR_FILL.MIN) return ANSWER_STATE.ANSWERED_MARKED;
  return ANSWER_STATE.NOT_ANSWERED;
}

/** The inverse, for redrawing a bubble on return or reload. A state holding no option holds no ink. */
export const omrFillFor = (state: AnswerState): number => OMR_FILL_BY_STATE[state];

const OMR_FILL_BY_STATE: Readonly<Record<AnswerState, number>> = {
  [ANSWER_STATE.NOT_VISITED]: 0,
  [ANSWER_STATE.NOT_ANSWERED]: 0,
  [ANSWER_STATE.MARKED_REVIEW]: 0,
  [ANSWER_STATE.ANSWERED_MARKED]: OMR_FILL.PARTIAL,
  [ANSWER_STATE.ANSWERED]: OMR_FILL.FULL,
};

/** One section's slice of a scored paper — exactly what `Attempt.sectionScores` holds. */
export const attemptSectionScoreSchema = z.object({
  baseConfigSectionId: z.string(),
  score: z.number(),
  correctCount: z.number().int(),
  wrongCount: z.number().int(),
  unattemptedCount: z.number().int(),
  timeSpentSec: z.number().int(),
});
export type AttemptSectionScore = z.infer<typeof attemptSectionScoreSchema>;

export const attemptSchema = z.object({
  id: z.string(),
  testId: z.string(),
  studentId: z.string(),
  attemptNo: z.number().int(),
  /** True for the one ranked attempt. The cohort rollup fires on it alone. */
  isGraded: z.boolean(),
  status: attemptStatusSchema,
  startedAt: z.string(),
  /** Server-authoritative. The client clock only counts down to it. */
  endsAt: z.string(),
  submittedAt: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  shuffleSeed: z.number().int(),
  languages: z.array(languageCodeSchema),
  score: z.number().nullable(),
  correctCount: z.number().int().nullable(),
  wrongCount: z.number().int().nullable(),
  unattemptedCount: z.number().int().nullable(),
  sectionScores: z.array(attemptSectionScoreSchema).nullable(),
  /** Snapshots. The live values are always read from Redis. */
  lastRank: z.number().int().nullable(),
  lastPercentile: z.number().nullable(),
  createdAt: z.string(),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** One row per question served in an attempt, plus the response. */
export const attemptQuestionSchema = z.object({
  attemptId: z.string(),
  questionId: z.string(),
  /** Always set: a GENERATED test's variants are real paper rows, so marks have one home. */
  paperQuestionId: z.string().nullable(),
  /** Always present, so the row reproduces without a join. */
  questionVersionId: z.string(),
  baseConfigSectionId: z.string(),
  /** This student's display order, not the paper's. */
  order: z.number().int(),
  /** An option id inside the version's options JSON — validated by the service, not a foreign key. */
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  state: answerStateSchema,
  timeSpentSec: z.number().int(),
  isCorrect: z.boolean().nullable(),
  marksAwarded: z.number().nullable(),
  answeredAt: z.string().nullable(),
});
export type AttemptQuestion = z.infer<typeof attemptQuestionSchema>;

// ============================================================================
// Starting one. Nothing about TIMING comes off the request — the server sets
// `startedAt` and `endsAt` from the config, and the client only counts down.
// ============================================================================

/** Which languages this student sits in. Must be ones the config offers. */
export const startAttemptSchema = z.object({
  languages: z.array(languageCodeSchema).min(1).optional(),
});
export type StartAttemptInput = z.input<typeof startAttemptSchema>;
export type StartAttemptBody = z.infer<typeof startAttemptSchema>;

/** The attempt plus what the exam screen needs to draw its frame before the paper arrives. */
export const liveAttemptSchema = attemptSchema.extend({
  /** True when this call started it, false when it resumed one already running. */
  startedByThisCall: z.boolean(),
  testTitle: z.string().nullable(),
  durationSec: z.number().int(),
  totalQuestions: z.number().int(),
});
export type LiveAttempt = z.infer<typeof liveAttemptSchema>;

// ============================================================================
// The live sitting. Everything here lives in Redis until the flusher or submit
// moves it, so a student answering a hundred questions writes Postgres never.
// ============================================================================

/** One question's change since the last save. A batch is a DELTA, not the whole paper. */
export const answerChangeSchema = z.object({
  questionId: z.string().min(1),
  /** What the screen believes. The server derives the truth from the answer and the mark. */
  state: answerStateSchema,
  selectedOptionId: z.string().min(1).nullish(),
  typedAnswer: z.string().nullish(),
  /** Total seconds on this question so far, as the screen has counted them. */
  timeSpentSec: z.number().int().min(0),
});
export type AnswerChange = z.infer<typeof answerChangeSchema>;

/** Where a sectional clock has got to. Absent for a composite paper, which has one clock. */
export const sectionProgressSchema = z.object({
  remainingSec: z.number().int().min(0),
  closed: z.boolean(),
});
export type SectionProgress = z.infer<typeof sectionProgressSchema>;

/** A screenful of answers is one save; a paper is 100, so a batch never needs to be larger. */
export const SAVE_BATCH_MAX = 200;

export const saveAttemptStateSchema = z.object({
  /** The screen's own counter. A batch that arrives after a newer one is dropped, not applied. */
  revision: z.number().int().min(0),
  answers: z.array(answerChangeSchema).max(SAVE_BATCH_MAX),
  sections: z.record(z.string(), sectionProgressSchema).optional(),
});
export type SaveAttemptStateInput = z.input<typeof saveAttemptStateSchema>;
export type SaveAttemptStateBody = z.infer<typeof saveAttemptStateSchema>;

/** One question as the live state holds it — the palette is drawn from exactly this. */
export const liveAnswerSchema = z.object({
  state: answerStateSchema,
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  timeSpentSec: z.number().int(),
  /** When the answer was GIVEN. Held here so a flush writes the same row however often it runs. */
  answeredAt: z.string().nullable(),
});
export type LiveAnswer = z.infer<typeof liveAnswerSchema>;

/** What Redis holds for one sitting. Returned on every save, so the screen can reconcile. */
export const liveAttemptStateSchema = z.object({
  attemptId: z.string(),
  revision: z.number().int(),
  answers: z.record(z.string(), liveAnswerSchema),
  sections: z.record(z.string(), sectionProgressSchema),
  /** The server's deadline again, so a save is also a clock check. */
  endsAt: z.string(),
  serverNow: z.string(),
});
export type LiveAttemptState = z.infer<typeof liveAttemptStateSchema>;

/** What a student reads BEFORE the clock starts. No question and no answer is in here. */
export const examBriefSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  durationSec: z.number().int(),
  totalQuestions: z.number().int(),
  languageMode: languageModeSchema,
  /** What this paper is offered in. SINGLE lets the student pick one; DUAL shows both. */
  languages: z.array(languageCodeSchema),
  sections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      questionCount: z.number().int(),
      durationSec: z.number().int().nullable(),
      marksPerQuestion: z.number(),
      negativeMarks: z.number(),
    }),
  ),
});
export type ExamBrief = z.infer<typeof examBriefSchema>;

// ============================================================================
// The exam screen's arithmetic. Pure, and here rather than in the SPA, because
// the countdown and the palette are the two things a sitting cannot get wrong.
// ============================================================================

/** The clock the screen counts down. Anchored to the SERVER's now, never the device's. */
export interface ExamClock {
  endsAt: string;
  serverNow: string;
  /** `Date.now()` when the paper arrived, so device skew cancels out of the subtraction. */
  arrivedAt: number;
}

/** The device clock measures only how long the PAGE has been open, so a fast machine gains nothing. */
export function secondsLeft(clock: ExamClock, deviceNow: number): number {
  const grantedMs = Date.parse(clock.endsAt) - Date.parse(clock.serverNow);
  const elapsedMs = deviceNow - clock.arrivedAt;
  return Math.max(0, Math.round((grantedMs - elapsedMs) / MILLISECONDS_PER_SECOND));
}

/** `1:59:03`, and `09:58` under an hour — a clock nobody has to parse. */
export function clockText(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export type PaletteCounts = Record<AnswerState, number>;

/** What the right rail counts. Every question is in exactly one state, so these sum to the paper. */
export function paletteCounts(
  questionIds: readonly string[],
  answers: Readonly<Record<string, { state: AnswerState }>>,
): PaletteCounts {
  const counts = Object.fromEntries(ANSWER_STATES.map((state) => [state, 0])) as PaletteCounts;
  for (const id of questionIds) {
    counts[answers[id]?.state ?? ANSWER_STATE.NOT_VISITED] += 1;
  }
  return counts;
}

/** The seat after this one, wrapping to the first: "next" is never a dead end mid-paper. */
export function nextQuestionId(
  questionIds: readonly string[],
  currentId: string | null,
): string | null {
  const seat = currentId === null ? -1 : questionIds.indexOf(currentId);
  return questionIds[seat + 1] ?? questionIds[0] ?? null;
}

/** Where a closed section hands over. Null means every other section has closed too. */
export function nextOpenSectionId(
  sections: readonly { id: string }[],
  closed: Readonly<Record<string, { closed: boolean }>>,
  leaving: string,
): string | null {
  const next = sections.find((section) => section.id !== leaving && !closed[section.id]?.closed);
  return next?.id ?? null;
}

/** Which sections a student may open. A sectional clock shuts the ones behind and ahead of it. */
export function openSections(
  sections: readonly { id: string }[],
  sectional: boolean,
  closed: Readonly<Record<string, { closed: boolean }>>,
): string[] {
  if (!sectional) return sections.map((section) => section.id);

  const current = sections.find((section) => !closed[section.id]?.closed);
  return current ? [current.id] : [];
}

const MILLISECONDS_PER_SECOND = 1000;

export const ME_ATTEMPT_ROUTES = {
  brief: (testId: string) => `/me/tests/${testId}/brief`,
  start: (testId: string) => `/me/tests/${testId}/attempt`,
  paper: (attemptId: string) => `/me/attempts/${attemptId}/paper`,
  state: (attemptId: string) => `/me/attempts/${attemptId}/state`,
  submit: (attemptId: string) => `/me/attempts/${attemptId}/submit`,
  scoreCard: (attemptId: string) => `/me/attempts/${attemptId}/scorecard`,
  solutions: (attemptId: string) => `/me/attempts/${attemptId}/solutions`,
  analytics: (attemptId: string) => `/me/attempts/${attemptId}/analytics`,
  questionReport: (attemptId: string) => `/me/attempts/${attemptId}/question-report`,
  performance: '/me/performance',
  /** Sitting COUNTS by institute day, so a calendar is not capped by the trend's twenty. */
  practiceDays: '/me/performance/days',
} as const;

/** How a sitting ended. A second submit reports the first one's outcome rather than refusing. */
export const submittedAttemptSchema = z.object({
  attemptId: z.string(),
  status: attemptStatusSchema,
  submittedAt: z.string(),
  /** False when the sweeper or an earlier call had already ended it — the same answer, not an error. */
  submittedByThisCall: z.boolean(),
  /** What was written durably as it ended, so the screen can say what it submitted. */
  answeredCount: z.number().int(),
});
export type SubmittedAttempt = z.infer<typeof submittedAttemptSchema>;

// ============================================================================
// The paper a student sits. Everything here crosses to a browser, so nothing
// here may carry an answer: no `isCorrect`, no answer key, no marks awarded.
// ============================================================================

/** An option as a candidate sees it. `questionOptionSchema` carries `isCorrect`; this cannot. */
export const examOptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  text: localizedRichSchema,
});
export type ExamOption = z.infer<typeof examOptionSchema>;

export const examQuestionSchema = z.object({
  questionId: z.string(),
  /** This student's display order, stored at start — not the paper's. */
  order: z.number().int(),
  baseConfigSectionId: z.string(),
  type: questionTypeSchema,
  marks: z.number(),
  negativeMarks: z.number(),
  /** Only the languages this sitting is in, and only the ones the question actually has. */
  content: localizedContentSchema,
  options: z.array(examOptionSchema),
});
export type ExamQuestion = z.infer<typeof examQuestionSchema>;

/** A section tab, and the clock it carries when the paper is sectional. */
export const examSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  questionCount: z.number().int(),
  durationSec: z.number().int().nullable(),
});
export type ExamSection = z.infer<typeof examSectionSchema>;

export const examPaperSchema = z.object({
  attemptId: z.string(),
  /** The deadline the countdown counts to. The client never computes one. */
  endsAt: z.string(),
  /** What the server's clock read as it answered: a skewed device must not lengthen a sitting. */
  serverNow: z.string(),
  languages: z.array(languageCodeSchema),
  languageMode: languageModeSchema,
  /** Which skin draws this sitting. The screen reads it; it is never hardcoded. */
  examTemplate: examTemplateSchema,
  /** How the student answers — CBT picks an option, OMR fills a bubble. One engine under both. */
  testUi: testUiSchema,
  timerTemplate: timerTemplateSchema,
  navigation: navigationPolicySchema,
  calculatorEnabled: z.boolean(),
  sections: z.array(examSectionSchema),
  questions: z.array(examQuestionSchema),
});
export type ExamPaper = z.infer<typeof examPaperSchema>;

// ============================================================================
// The Score Card. Marks, standing and the student's OWN answers — nothing here
// says what the right answer was, which is why a missed question is safe to
// show. The correct option rides only on the gated Solution Report.
// ============================================================================

/** How one question went FOR THIS STUDENT. There is deliberately no correct option on it. */
export const scoreCardQuestionSchema = z.object({
  questionId: z.string(),
  /** This student's display order, so the palette redraws exactly as they sat it. */
  order: z.number().int(),
  baseConfigSectionId: z.string(),
  state: answerStateSchema,
  /** Their own answer. Safe: on a miss it says what they picked, never what was right. */
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  marksAwarded: z.number().nullable(),
  /** What the paper was paying and charging here — the arithmetic, shown. */
  marks: z.number(),
  negativeMarks: z.number(),
  /** Set when the question was withdrawn or made a bonus, which is why its marks read oddly. */
  disposition: paperQuestionStatusSchema,
  timeSpentSec: z.number().int(),
});
export type ScoreCardQuestion = z.infer<typeof scoreCardQuestionSchema>;

export const scoreCardSectionSchema = attemptSectionScoreSchema.extend({
  name: z.string(),
  order: z.number().int(),
  questionCount: z.number().int(),
  maxMarks: z.number(),
});
export type ScoreCardSection = z.infer<typeof scoreCardSectionSchema>;

export const scoreCardSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  attemptNo: z.number().int(),
  /** False for a retake: it is marked, but it is not in the ranking. */
  isGraded: z.boolean(),
  submittedAt: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  score: z.number(),
  maxMarks: z.number(),
  percentage: z.number(),
  correctCount: z.number().int(),
  wrongCount: z.number().int(),
  unattemptedCount: z.number().int(),
  totalQuestions: z.number().int(),
  timeTakenSec: z.number().int(),
  durationSec: z.number().int(),
  /** Live from the ranking. Null for a retake, and while a wiped board is being put back. */
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int().nullable(),
  /** True while the test can still be sat by somebody, so the standing is not final yet. */
  provisional: z.boolean(),
  sections: z.array(scoreCardSectionSchema),
  questions: z.array(scoreCardQuestionSchema),
});
export type ScoreCard = z.infer<typeof scoreCardSchema>;

// ============================================================================
// The Solution Report — the ONE payload the answer key rides on, and only once
// the gate has opened. Everything a Score Card carries, plus what was right.
// ============================================================================

/** One question, reviewed. `options` carry `isCorrect`, which is why this whole shape is gated. */
export const solutionQuestionSchema = scoreCardQuestionSchema.extend({
  type: questionTypeSchema,
  /** Stem AND the worked solution, in the languages this sitting was taken in. */
  content: localizedContentSchema,
  options: z.array(questionOptionSchema),
  /** TEXT_FIELD only: what a typed answer was compared against. */
  answerKey: answerKeySchema.nullable(),
});
export type SolutionQuestion = z.infer<typeof solutionQuestionSchema>;

export const solutionReportSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  languages: z.array(languageCodeSchema),
  /** When the key opened. Null when there was never anything to wait for. */
  openedAt: z.string().nullable(),
  sections: z.array(examSectionSchema),
  questions: z.array(solutionQuestionSchema),
});
export type SolutionReport = z.infer<typeof solutionReportSchema>;

// ============================================================================
// Analytics. Every figure below is DERIVED from rows the exam already wrote —
// the option chosen, the palette state, the seconds on each question — so
// nothing here needs a new column or a new event to be true.
// ============================================================================

/** One slice of a paper: a section, a subject, a difficulty band, or the whole thing. */
export const analyticsBucketSchema = z.object({
  key: z.string(),
  name: z.string(),
  total: z.number().int(),
  attempted: z.number().int(),
  correct: z.number().int(),
  wrong: z.number().int(),
  unattempted: z.number().int(),
  /** Correct over ATTEMPTED. An answer nothing could judge is attempted and neither right nor wrong. */
  accuracy: z.number(),
  marks: z.number(),
  timeSpentSec: z.number().int(),
});
export type AnalyticsBucket = z.infer<typeof analyticsBucketSchema>;

export const timeUseSchema = z.object({
  totalSec: z.number().int(),
  avgPerQuestionSec: z.number(),
  avgOnCorrectSec: z.number(),
  avgOnWrongSec: z.number(),
  /** Time the paper took and gave nothing back for. */
  spentOnUnattemptedSec: z.number().int(),
});
export type TimeUse = z.infer<typeof timeUseSchema>;

/** The five palette states, which partition the paper. No revisit count: the exam never wrote one. */
export const attemptStrategySchema = z.object({
  answered: z.number().int(),
  answeredAndMarked: z.number().int(),
  markedOnly: z.number().int(),
  seenAndLeft: z.number().int(),
  neverOpened: z.number().int(),
});
export type AttemptStrategy = z.infer<typeof attemptStrategySchema>;

/** Where this sitting stands against the ones around it. Null where the cohort cannot say. */
export const cohortStandingSchema = z.object({
  score: z.number(),
  topperScore: z.number().nullable(),
  averageScore: z.number().nullable(),
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int().nullable(),
});
export type CohortStanding = z.infer<typeof cohortStandingSchema>;

export const attemptAnalyticsSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  overall: analyticsBucketSchema,
  sections: z.array(analyticsBucketSchema),
  subjects: z.array(analyticsBucketSchema),
  difficulty: z.array(analyticsBucketSchema),
  time: timeUseSchema,
  strategy: attemptStrategySchema,
  cohort: cohortStandingSchema,
});
export type AttemptAnalytics = z.infer<typeof attemptAnalyticsSchema>;

/** One sat test on the trend line, oldest first — what a chart plots. */
export const performancePointSchema = z.object({
  attemptId: z.string(),
  attemptNo: z.number().int(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  /** Ranked or practice: only a ranked paper has a board, so a picker for one filters on it. */
  evaluationMode: evaluationModeSchema,
  submittedAt: z.string().nullable(),
  score: z.number(),
  maxMarks: z.number(),
  percentage: z.number(),
  accuracy: z.number(),
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
});
export type PerformancePoint = z.infer<typeof performancePointSchema>;

export const performanceTrendSchema = z.object({
  /** Distinct TESTS, not sittings: three retakes of one paper is one test done. */
  testsSat: z.number().int(),
  points: z.array(performancePointSchema),
});
export type PerformanceTrend = z.infer<typeof performanceTrendSchema>;
