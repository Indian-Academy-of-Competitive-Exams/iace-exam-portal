/** A typing passage in a sitting: the practice screen's own pane, fed by the sitting's answer and its lock. */
import { DEFAULT_LANGUAGE, TYPING_PRESETS, plainTextOf, typingPassageText } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { TypingPane } from '../../../typing/typing-pane';

export function ExamTyping({ view }: Readonly<{ view: ExamView }>) {
  const { question } = view;
  if (!question) return null;

  const preset = view.sections.find((section) => section.id === view.sectionId)?.typingPreset;
  return (
    <TypingPane
      // Keyed, so a second passage never opens on the first one's text.
      key={question.questionId}
      passage={typingPassageText(plainTextOf(question.content[DEFAULT_LANGUAGE]?.stem))}
      value={view.typedAnswer}
      onChange={view.typeAnswer}
      // A section with no standard named is held to none, so nothing is refused.
      backspace={preset ? TYPING_PRESETS[preset].backspace : true}
      disabled={view.locked !== null}
    />
  );
}
