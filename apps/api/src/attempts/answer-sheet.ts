/**
 * A sitting's answers as one positional array: slot N is paper row N in `PaperQuestion.order`,
 * whatever order the screen showed. Pure, so the format can be read as a table and tested as one.
 */
import { ANSWERED_STATES, ANSWER_STATE, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { displayOrder } from './attempt-rules';

/** A slot's state is its index here. Append only: a stored sheet is read for as long as it exists. */
export const SLOT_STATES: readonly AnswerState[] = [
  ANSWER_STATE.NOT_VISITED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
];

type SlotHead = [
  state: number,
  option: number | string | null,
  timeSpentSec: number,
  firstActionSec: number | null,
  answeredSec: number | null,
];

/** Times are whole seconds after `startedAt`; a typed answer rides in a sixth place only when given. */
export type AnswerSlot =
  | SlotHead
  | [
      state: number,
      option: number | string | null,
      timeSpentSec: number,
      firstActionSec: number | null,
      answeredSec: number | null,
      typedAnswer: string,
    ];

export type AnswerSheet = (AnswerSlot | null)[];

/** The key's verdict and the marks it paid, written by the scorer and nobody else. */
export type VerdictSlot = [isCorrect: boolean | null, marksAwarded: number];

export interface SheetRow {
  questionId: string;
  optionIds: readonly string[];
}

export interface ServedRow extends SheetRow {
  baseConfigSectionId: string;
}

export interface SheetSitting {
  startedAt: Date;
  shuffleSeed: number;
  sheet: { answers: unknown; verdicts?: unknown } | null;
}

/** One served question's answer and its verdict, decoded off the sheet. */
export interface ServedAnswer {
  order: number;
  state: AnswerState;
  selectedOptionId: string | null;
  typedAnswer: string | null;
  timeSpentSec: number;
  answeredAt: Date | null;
  firstActionAt: Date | null;
  isCorrect: boolean | null;
  marksAwarded: number | null;
}

const MILLISECONDS_PER_SECOND = 1000;
const ANSWERED = new Set<AnswerState>(ANSWERED_STATES);

export const blankSheet = (size: number): AnswerSheet => Array.from({ length: size }, () => null);

const secondsAfter = (startedAt: Date, at: string | null): number | null =>
  at === null ? null : Math.floor((Date.parse(at) - startedAt.getTime()) / MILLISECONDS_PER_SECOND);

const instantAt = (startedAt: Date, seconds: number | null): string | null =>
  seconds === null
    ? null
    : new Date(startedAt.getTime() + seconds * MILLISECONDS_PER_SECOND).toISOString();

/** A position into the paper row's options; an id the row does not hold is kept as sent, and scores wrong. */
function optionOf(selected: string | null, optionIds: readonly string[]): number | string | null {
  if (selected === null) return null;
  const position = optionIds.indexOf(selected);
  return position === -1 ? selected : position;
}

export function encodeAnswer(
  answer: LiveAnswer,
  optionIds: readonly string[],
  startedAt: Date,
): AnswerSlot {
  const head: SlotHead = [
    SLOT_STATES.indexOf(answer.state),
    optionOf(answer.selectedOptionId, optionIds),
    answer.timeSpentSec,
    secondsAfter(startedAt, answer.firstActionAt),
    secondsAfter(startedAt, answer.answeredAt),
  ];
  return answer.typedAnswer === null ? head : [...head, answer.typedAnswer];
}

export function decodeAnswer(
  slot: AnswerSlot | null | undefined,
  optionIds: readonly string[],
  startedAt: Date,
): LiveAnswer | null {
  if (!slot) return null;
  const [state, option, timeSpentSec, firstActionSec, answeredSec] = slot;
  return {
    state: SLOT_STATES[state] ?? ANSWER_STATE.NOT_VISITED,
    selectedOptionId: typeof option === 'number' ? (optionIds[option] ?? null) : option,
    typedAnswer: slot.length === 6 ? slot[5] : null,
    timeSpentSec,
    answeredAt: instantAt(startedAt, answeredSec),
    firstActionAt: instantAt(startedAt, firstActionSec),
  };
}

/** A column read back: anything but an array is a sheet nothing has written, which is an untouched one. */
export const sheetIn = (stored: unknown): AnswerSheet =>
  Array.isArray(stored) ? (stored as AnswerSheet) : [];

const verdictsIn = (stored: unknown): VerdictSlot[] | null =>
  Array.isArray(stored) ? (stored as VerdictSlot[]) : null;

/** The whole sheet from the live answers; an answer to a question off the paper has nowhere to go. */
export function sheetOf(
  answers: Readonly<Record<string, LiveAnswer>>,
  paper: readonly SheetRow[],
  startedAt: Date,
): AnswerSheet {
  return paper.map((row) => {
    const answer = answers[row.questionId];
    return answer ? encodeAnswer(answer, row.optionIds, startedAt) : null;
  });
}

/** The live answers a stored sheet holds, keyed by question: what a lost Redis key is put back from. */
export function answersOf(
  stored: unknown,
  paper: readonly SheetRow[],
  startedAt: Date,
): Record<string, LiveAnswer> {
  const sheet = sheetIn(stored);
  const answers: Record<string, LiveAnswer> = {};
  paper.forEach((row, slot) => {
    const answer = decodeAnswer(sheet[slot], row.optionIds, startedAt);
    if (answer) answers[row.questionId] = answer;
  });
  return answers;
}

/** The scorer's marks at their paper rows; a row it did not score reads as untouched. */
export function verdictsOf(
  scores: readonly { questionId: string; isCorrect: boolean | null; marksAwarded: number }[],
  paper: readonly { questionId: string }[],
): VerdictSlot[] {
  const byQuestion = new Map(scores.map((score) => [score.questionId, score]));
  return paper.map((row) => {
    const score = byQuestion.get(row.questionId);
    return [score?.isCorrect ?? null, score?.marksAwarded ?? 0];
  });
}

/** `paper` in paper order; the rows come back in the order this sitting was shown them. */
export function servedSheet<P extends ServedRow>(
  paper: readonly P[],
  sitting: SheetSitting,
  shuffleQuestions: boolean,
): (P & ServedAnswer)[] {
  const sheet = sheetIn(sitting.sheet?.answers);
  const verdicts = verdictsIn(sitting.sheet?.verdicts);
  const rows = paper.map((row, slot) => {
    const answer = decodeAnswer(sheet[slot], row.optionIds, sitting.startedAt);
    const verdict = verdicts?.[slot];
    return {
      ...row,
      order: 0,
      state: answer?.state ?? ANSWER_STATE.NOT_VISITED,
      selectedOptionId: answer?.selectedOptionId ?? null,
      typedAnswer: answer?.typedAnswer ?? null,
      timeSpentSec: answer?.timeSpentSec ?? 0,
      answeredAt: answer?.answeredAt ? new Date(answer.answeredAt) : null,
      firstActionAt: answer?.firstActionAt ? new Date(answer.firstActionAt) : null,
      isCorrect: verdict?.[0] ?? null,
      marksAwarded: verdict === undefined ? null : verdict[1],
    };
  });
  return displayOrder(rows, sitting.shuffleSeed, shuffleQuestions).map((row, index) => ({
    ...row,
    order: index + 1,
  }));
}

export const timeSpentIn = (stored: unknown): number =>
  sheetIn(stored).reduce((total, slot) => total + (slot?.[2] ?? 0), 0);

/** Answers given, however they were left marked. */
export const answeredIn = (stored: unknown): number =>
  sheetIn(stored).filter(
    (slot) => slot !== null && ANSWERED.has(SLOT_STATES[slot[0]] ?? ANSWER_STATE.NOT_VISITED),
  ).length;
