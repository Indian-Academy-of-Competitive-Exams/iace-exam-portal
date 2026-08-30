/** What a paper is worth, worked out without a database, so the rules can be read as a table. */
import {
  ANSWER_MODE,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  type AnswerKey,
  type AttemptSectionScore,
  type PaperQuestionStatus,
  type QuestionType,
} from '@iace/contracts';

/** One served question with its response and the paper's terms for it, already joined. */
export interface ScorableQuestion {
  questionId: string;
  baseConfigSectionId: string;
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  status: PaperQuestionStatus;
  correctOptionIds: readonly string[];
  answerKey: AnswerKey | null;
  selectedOptionId: string | null;
  typedAnswer: string | null;
  timeSpentSec: number;
}

/** `isCorrect` is the ANSWER KEY's verdict; a drop or a bonus moves the marks, never the verdict. */
export interface QuestionScore {
  questionId: string;
  isCorrect: boolean | null;
  marksAwarded: number;
}

export interface PaperScore {
  questions: QuestionScore[];
  score: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  sections: AttemptSectionScore[];
}

/** The `Json?` column read back. Null until a scorer has written it, which is most of a sitting. */
export function sectionScoresIn(stored: unknown): AttemptSectionScore[] | null {
  return Array.isArray(stored) ? (stored as AttemptSectionScore[]) : null;
}

/** Marks are Decimal(6,2), so everything is summed in whole hundredths and divided once at the end. */
const HUNDREDTHS = 100;
const toHundredths = (marks: number) => Math.round(marks * HUNDREDTHS);
const fromHundredths = (total: number) => total / HUNDREDTHS;

/** Binary floating point puts 0.1 + 0.2 just past 0.3, and a tolerance is a boundary. */
const TOLERANCE_SLACK = 1e-9;

export function scorePaper(paper: readonly ScorableQuestion[]): PaperScore {
  const questions: QuestionScore[] = [];
  const sections = new Map<string, AttemptSectionScore>();
  let total = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  for (const row of paper) {
    const verdict = verdictOn(row);
    const awarded = awardFor(row, verdict);
    questions.push({ questionId: row.questionId, isCorrect: verdict, marksAwarded: awarded });

    total += toHundredths(awarded);
    if (verdict === true) correctCount += 1;
    else if (verdict === false) wrongCount += 1;
    else unattemptedCount += 1;

    tallySection(sections, row, verdict, awarded);
  }

  return {
    questions,
    score: fromHundredths(total),
    correctCount,
    wrongCount,
    unattemptedCount,
    sections: [...sections.values()].map(divideSection),
  };
}

/** Null when they left it alone, AND when nothing here can judge it — see the two below. */
function verdictOn(row: ScorableQuestion): boolean | null {
  if (row.type === QUESTION_TYPE.TEXT_FIELD) return typedVerdict(row);
  if (row.selectedOptionId === null || row.correctOptionIds.length === 0) return null;
  return row.correctOptionIds.includes(row.selectedOptionId);
}

/** A key nobody can compare against reads as untouched: a broken one must not mark a cohort down. */
function typedVerdict(row: ScorableQuestion): boolean | null {
  const typed = row.typedAnswer?.trim() ?? '';
  const key = row.answerKey;
  if (typed === '' || key === null) return null;

  const accepted = Object.values(key.answers).filter((value) => typeof value === 'string');
  if (accepted.length === 0) return null;
  if (key.mode !== ANSWER_MODE.NUMERIC) {
    const given = fold(typed);
    return accepted.some((answer) => fold(answer) === given);
  }

  const given = Number(typed);
  if (!Number.isFinite(given)) return false;
  const slack = (key.tolerance ?? 0) + TOLERANCE_SLACK;
  return accepted.some((answer) => {
    const wanted = Number(answer.trim());
    return Number.isFinite(wanted) && Math.abs(given - wanted) <= slack;
  });
}

/** DROPPED pays everyone who attempted and takes back the negative; BONUS pays the whole cohort. */
function awardFor(row: ScorableQuestion, verdict: boolean | null): number {
  if (row.status === PAPER_QUESTION_STATUS.BONUS) return row.marks;
  if (row.status === PAPER_QUESTION_STATUS.DROPPED) return verdict === null ? 0 : row.marks;
  if (verdict === null) return 0;
  return verdict ? row.marks : -row.negativeMarks;
}

/** Case and inner spacing are typing, not knowledge. */
const fold = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Sections accumulate in hundredths too, and are divided down once the paper is done. */
function tallySection(
  sections: Map<string, AttemptSectionScore>,
  row: ScorableQuestion,
  verdict: boolean | null,
  awarded: number,
): void {
  const held = sections.get(row.baseConfigSectionId) ?? {
    baseConfigSectionId: row.baseConfigSectionId,
    score: 0,
    correctCount: 0,
    wrongCount: 0,
    unattemptedCount: 0,
    timeSpentSec: 0,
  };
  held.score += toHundredths(awarded);
  if (verdict === true) held.correctCount += 1;
  else if (verdict === false) held.wrongCount += 1;
  else held.unattemptedCount += 1;
  held.timeSpentSec += row.timeSpentSec;
  sections.set(row.baseConfigSectionId, held);
}

const divideSection = (section: AttemptSectionScore): AttemptSectionScore => ({
  ...section,
  score: fromHundredths(section.score),
});
