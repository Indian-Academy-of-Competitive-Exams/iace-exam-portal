import { useEffect, useRef } from 'react';

/** Makes a skin's own dialog box modal in fact: everything beside its overlay is inert while it is up, so the paper behind cannot be tabbed to or answered. */
export function useModalBox<T extends HTMLElement>(onEscape?: () => void) {
  const box = useRef<T>(null);
  const escape = useRef(onEscape);
  // Read when the key is pressed, so the listener below is bound once and still closes the box of this render.
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const overlay = box.current?.parentElement;
    // Only what this box silenced is woken again: a paper already inert under a warning stays so.
    const silenced = [...(overlay?.parentElement?.children ?? [])].filter(
      (beside) => beside !== overlay && !beside.hasAttribute('inert'),
    );
    for (const beside of silenced) beside.setAttribute('inert', '');

    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escape.current?.();
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      for (const beside of silenced) beside.removeAttribute('inert');
    };
  }, []);

  return box;
}
