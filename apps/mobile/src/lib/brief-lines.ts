/** The one line a section reads as on the two screens that list a paper's sections. */
import { type ExamBrief } from '@iace/contracts';
import { plural } from './plural';

const SECONDS_PER_MINUTE = 60;

export function sectionLine(section: ExamBrief['sections'][number]): string {
  const clock =
    section.durationSec === null
      ? null
      : `${Math.round(section.durationSec / SECONDS_PER_MINUTE)} min`;
  return [
    plural(section.questionCount, 'question'),
    `+${section.marksPerQuestion} / −${section.negativeMarks}`,
    clock,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

export const NEEDS_KEYBOARD_SAYS = 'This test has a typing section. Sit it on a computer.';

/** A typing section is typed on a real keyboard, so its paper is never started from a phone. */
export const needsKeyboard = (brief: ExamBrief): boolean =>
  brief.sections.some((section) => Boolean(section.typingPreset));
