import { QUESTION_TYPE, type ValidationIssue } from '@iace/contracts';
import { answerIndexOf, optionLetter, type AuthoringState } from './question-scaffold';
import { type Check } from './authoring-preview';

/** What the rules found, said as the checklist a typist reads top to bottom. */
export function checksFor(
  state: AuthoringState,
  issues: readonly ValidationIssue[],
  missing: readonly string[],
  duplicate: string | null,
): Check[] {
  const failing = (...codes: string[]) => issues.find((issue) => codes.includes(issue.code));
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;

  const structure = failing(
    'ENGLISH_STEM_REQUIRED',
    'OPTION_COUNT_INVALID',
    'OPTION_TEXT_REQUIRED',
    'OPTION_TEXT_DUPLICATE',
    'OPTIONS_NOT_ALLOWED',
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

  const checks: Check[] = [
    {
      key: 'structure',
      label: structure?.message ?? (isMcq ? 'English text and every option' : 'English text'),
      state: structure ? 'fail' : 'pass',
      meta: isMcq ? `${state.optionCount} options` : undefined,
    },
    {
      key: 'answered',
      label: answered?.message ?? (isMcq ? 'Exactly one correct answer' : 'An answer to compare'),
      state: answered ? 'fail' : 'pass',
      meta: isMcq && correct !== null ? optionLetter(correct) : undefined,
    },
    {
      key: 'math',
      label: math?.message ?? 'Every formula renders',
      state: math ? 'fail' : 'pass',
    },
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
      meta: 'Alt+L to switch',
    });
  }

  if (duplicate) {
    checks.push({ key: 'duplicate', label: duplicate, state: 'warn', meta: 'already in the bank' });
  }

  return checks;
}
