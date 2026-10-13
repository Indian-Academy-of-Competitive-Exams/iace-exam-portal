/** What a typing standard asks for and what a session came to, in the words the boards use. */
import {
  QUESTION_TYPE,
  TYPING_RULE,
  type ExamQuestion,
  type TypingPreset,
  type TypingRule,
} from '@iace/contracts';
import { plural } from '@iace/ui';

const SECONDS_PER_MINUTE = 60;

export const durationLabel = (preset: TypingPreset) =>
  plural(preset.durationSec / SECONDS_PER_MINUTE, 'minute');

export function mistakeRuleLabel(rule: TypingRule): string {
  if (rule.shape === TYPING_RULE.ERROR_CEILING) return `Within ${rule.ceilingPct}% of words typed`;
  return `${rule.allowancePct}% ignored, then ${plural(rule.penaltyWords, 'word')} off for each`;
}

/** Whether this question is typed rather than answered, which every skin asks before drawing options. */
export const isTypingQuestion = (question: ExamQuestion | undefined): boolean =>
  question?.type === QUESTION_TYPE.TYPING;

/** Whether this question is written free, which every skin asks before drawing options. */
export const isWrittenQuestion = (question: ExamQuestion | undefined): boolean =>
  question?.type === QUESTION_TYPE.DESCRIPTIVE;

/** Typed or written: its answer is minutes of work, so one click must never be able to clear it. */
export const answersByKeyboard = (question: ExamQuestion | undefined): boolean =>
  isTypingQuestion(question) || isWrittenQuestion(question);
