/** A typing passage in a sitting: the practice screen's own pane, fed by the sitting's answer and its lock. */
import { TYPING_PRESETS, typingPassageOf } from '@iace/contracts';
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
      passage={typingPassageOf(question.content)}
      saved={view.typedAnswer}
      onType={view.typeAnswer}
      // A section with no standard named is held to none, so nothing is refused.
      backspace={preset ? TYPING_PRESETS[preset].backspace : true}
      disabled={view.locked !== null || !view.answersLoaded}
    />
  );
}

function TypingDraft({
  passage,
  saved,
  onType,
  backspace,
  disabled,
}: Readonly<{
  passage: string;
  saved: string;
  onType: (text: string) => void;
  backspace: boolean;
  disabled: boolean;
}>) {
  const { text, setText } = useDraft(saved, onType);

  return (
    <TypingPane
      passage={passage}
      value={text}
      onChange={setText}
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
      onType={view.typeAnswer}
      disabled={view.locked !== null || !view.answersLoaded}
    />
  );
}

function WritingDraft({
  saved,
  onType,
  disabled,
}: Readonly<{ saved: string; onType: (text: string) => void; disabled: boolean }>) {
  const { text, setText } = useDraft(saved, onType);
  return <WritingBox value={text} onChange={setText} disabled={disabled} />;
}
