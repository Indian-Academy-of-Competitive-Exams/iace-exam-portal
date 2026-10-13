/** A box's own copy of its text, handed to the sitting when the typing pauses, the box is left, or it closes. */
import { useEffect, useRef, useState } from 'react';

/** How long the box is quiet before what it holds is handed over; a key is not a save. */
const HAND_OVER_AFTER_MS = 1000;

export function useDraft(saved: string, onHandOver: (text: string) => void) {
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

  return { text, setText, handOver };
}
