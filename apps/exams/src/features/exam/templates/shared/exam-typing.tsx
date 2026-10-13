/** A typing passage in a sitting: the practice screen's own pane, fed by the sitting's answer and its lock. */
import { DEFAULT_LANGUAGE, TYPING_PRESETS, plainTextOf, typingPassageText } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { TypingPane } from '../../../typing/typing-pane';
import { WritingBox } from '../../../typing/writing-box';
import { useDraft } from '../../../typing/use-draft';

export function ExamTyping({ view }: Readonly<{ view: ExamView }>) {
  const { question } = view;
  if (!question) return null;

  const preset = view.sections.find((section) => section.id === view.sectionId)?.typingPreset;
  return (
    <TypingDraft
      // Keyed on the saved text arriving too, so the box opens on it and never on an empty one.
      key={`${question.questionId}:${view.answersLoaded}`}
      passage={typingPassageText(plainTextOf(question.content[DEFAULT_LANGUAGE]?.stem))}
      saved={view.typedAnswer}
      onHandOver={view.typeAnswer}
      // A section with no standard named is held to none, so nothing is refused.
      backspace={preset ? TYPING_PRESETS[preset].backspace : true}
      disabled={view.locked !== null || !view.answersLoaded}
    />
  );
}

/** The box's own copy of the text, handed to the sitting when the typing pauses, the box is left, or it closes. */
function TypingDraft({
  passage,
  saved,
  onHandOver,
  backspace,
  disabled,
}: Readonly<{
  passage: string;
  saved: string;
  onHandOver: (text: string) => void;
  backspace: boolean;
  disabled: boolean;
}>) {
  const { text, setText, handOver } = useDraft(saved, onHandOver);

  return (
    <TypingPane
      passage={passage}
      value={text}
      onChange={setText}
      onBlur={handOver}
      backspace={backspace}
      disabled={disabled}
    />
  );
}

/** A descriptive question's answer: the skin draws the prompt above, and this is the box under it. */
export function ExamWriting({ view }: Readonly<{ view: ExamView }>) {
  const { question } = view;
  if (!question) return null;

  return (
    <WritingDraft
      // Keyed on the saved text arriving too, so the box opens on it and never on an empty one.
      key={`${question.questionId}:${view.answersLoaded}`}
      saved={view.typedAnswer}
      onHandOver={view.typeAnswer}
      disabled={view.locked !== null || !view.answersLoaded}
    />
  );
}

function WritingDraft({
  saved,
  onHandOver,
  disabled,
}: Readonly<{ saved: string; onHandOver: (text: string) => void; disabled: boolean }>) {
  const { text, setText, handOver } = useDraft(saved, onHandOver);
  return <WritingBox value={text} onChange={setText} onBlur={handOver} disabled={disabled} />;
}
