import { QUESTION_TYPE, type ExamQuestion } from '@iace/contracts';

/** Typed or written: its answer is minutes of work, so one tap must never be able to clear it. */
export const answersByKeyboard = (question: ExamQuestion | undefined): boolean =>
  question?.type === QUESTION_TYPE.TYPING || question?.type === QUESTION_TYPE.DESCRIPTIVE;
