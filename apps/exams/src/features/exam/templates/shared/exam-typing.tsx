/** A typing passage in a sitting: the practice screen's own pane, fed by the sitting's answer and its lock. */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LANGUAGE, TYPING_PRESETS, plainTextOf, typingPassageText } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { TypingPane } from '../../../typing/typing-pane';

/** How long the box is quiet before what it holds is handed to the sitting; a key is not a save. */
const HAND_OVER_AFTER_MS = 1000;

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
  const [text, setText] = useState(saved);
  const handed = useRef(saved);
  const latest = useRef({ text, onHandOver });

  useEffect(() => {
    latest.current = { text, onHandOver };
  });

  const handOver = () => {
    const held = latest.current;
    if (held.text === handed.current) return;
    handed.current = held.text;
    held.onHandOver(held.text);
  };

  useEffect(() => {
    const pause = setTimeout(handOver, HAND_OVER_AFTER_MS);
    return () => clearTimeout(pause);
  }, [text]);

  // Leaving the question takes the box away; what it held goes with the sitting, not with the box.
  useEffect(() => handOver, []);

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
