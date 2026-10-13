/** A paper with a typing or a writing section is sat at a keyboard, and a candidate is told before any clock starts. */
import { type ExamBrief } from '@iace/contracts';

export const NEEDS_KEYBOARD_SAYS =
  'This test has a typing or writing section. Sit it on a computer with a keyboard.';

export const needsKeyboard = (brief: ExamBrief): boolean =>
  brief.sections.some((section) => Boolean(section.typingPreset) || Boolean(section.descriptive));
