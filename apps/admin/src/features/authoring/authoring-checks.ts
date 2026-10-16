import {
  LANGUAGE_LABELS,
  QUESTION_TYPE,
  keyPointsOf,
  typingPassageText,
  type QuestionLanguage,
  type ValidationIssue,
} from '@iace/contracts';
import { answerIndexOf, optionLetter, type AuthoringState } from './question-scaffold';
import { KEY_NAMES } from '@iace/ui';
import { type Check } from './authoring-preview';

/** What the rules found, said as the checklist a typist reads top to bottom. */
export function checksFor(
  state: AuthoringState,
  issues: readonly ValidationIssue[],
  missing: readonly string[],
  duplicate: string | null,
  /** The language the question is written in first: its subject's, else English. */
  lead: QuestionLanguage,
): Check[] {
  const failing = (...codes: string[]) => issues.find((issue) => codes.includes(issue.code));
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;
  const isTyping = state.type === QUESTION_TYPE.TYPING;
  const keyDepressions = typingPassageText(state.content[lead].stem).length;

  const structure = failing(
    'ENGLISH_STEM_REQUIRED',
    'SUBJECT_LANGUAGE_REQUIRED',
    'LANGUAGE_OUTSIDE_SUBJECT',
    'TRANSLATION_WITHOUT_STEM',
    'OPTION_COUNT_INVALID',
    'OPTION_TEXT_REQUIRED',
    'OPTION_TEXT_DUPLICATE',
    'OPTIONS_NOT_ALLOWED',
    'TYPING_PASSAGE_NOT_PLAIN',
    'TYPING_PASSAGE_TOO_SHORT',
    'TYPING_PASSAGE_TOO_LONG',
    'WORD_LIMIT_INVALID',
  );
  const answered = failing(
    'CORRECT_OPTION_REQUIRED',
    'CORRECT_OPTION_INVALID',
    'ANSWER_REQUIRED',
    'ANSWER_NOT_NUMERIC',
    'ANSWER_NOT_ALLOWED',
    'ANSWER_MODE_INVALID',
    'TOLERANCE_NOT_ALLOWED',
  );
  const math = failing('MATH_INVALID');
  const filed = failing(
    'SUBJECT_REQUIRED',
    'SUBJECT_UNKNOWN',
    'TOPIC_UNKNOWN',
    'TOPIC_NOT_IN_SUBJECT',
  );
  const correct = answerIndexOf(state.answer, state.optionCount);

  const structured: Check = {
    key: 'structure',
    label: structure?.message ?? structureLabel(LANGUAGE_LABELS[lead], isMcq),
    state: structure ? 'fail' : 'pass',
    meta: structureMeta(state, keyDepressions),
  };
  // A typing passage is its own answer and carries no formula, so neither line has anything to say.
  const answerChecks: Check[] = [
    {
      key: 'answered',
      label: answered?.message ?? answeredLabel(state),
      state: answeredState(state, answered !== undefined),
      meta: isMcq && correct !== null ? optionLetter(correct) : undefined,
    },
    {
      key: 'math',
      label: math?.message ?? 'Every formula renders',
      state: math ? 'fail' : 'pass',
    },
  ];
  const checks: Check[] = [
    structured,
    ...(isTyping ? [] : answerChecks),
    {
      key: 'filed',
      label: filed?.message ?? 'Filed under a subject',
      state: filed ? 'fail' : 'pass',
    },
  ];

  if (missing.length > 0) {
    checks.push({
      key: 'languages',
      label: `${missing.join(' and ')} not entered yet`,
      state: 'warn',
      meta: `${KEY_NAMES.ALT}+L to switch`,
    });
  }

  if (duplicate) {
    checks.push({ key: 'duplicate', label: duplicate, state: 'fail', meta: 'already in the bank' });
  }

  return checks;
}

const structureLabel = (language: string, isMcq: boolean): string =>
  isMcq ? `${language} text and every option` : `${language} text`;

function structureMeta(state: AuthoringState, keyDepressions: number): string | undefined {
  if (state.type === QUESTION_TYPE.SINGLE_MCQ) return `${state.optionCount} options`;
  return state.type === QUESTION_TYPE.TYPING ? `${keyDepressions} key depressions` : undefined;
}

const isWritten = (state: AuthoringState) => state.type === QUESTION_TYPE.DESCRIPTIVE;
const namesNoPoint = (state: AuthoringState) =>
  isWritten(state) && keyPointsOf(state.answer).length === 0;

function answeredLabel(state: AuthoringState): string {
  if (state.type === QUESTION_TYPE.SINGLE_MCQ) return 'Exactly one correct answer';
  if (!isWritten(state)) return 'An answer to compare';
  // With no point to mark against, the scorer can only pay a fair attempt in full.
  return namesNoPoint(state)
    ? 'No key points: any answer of fair length takes full marks'
    : 'Key points to mark against';
}

function answeredState(state: AuthoringState, failing: boolean): Check['state'] {
  if (failing) return 'fail';
  return namesNoPoint(state) ? 'warn' : 'pass';
}
