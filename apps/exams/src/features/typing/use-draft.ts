/** A box's own copy of its text. Every key goes to the sitting, which takes it in once the typing pauses. */
import { useState } from 'react';

export function useDraft(saved: string, onType: (text: string) => void) {
  const [text, setText] = useState(saved);

  return {
    text,
    setText: (next: string) => {
      setText(next);
      onType(next);
    },
  };
}
