import { useState } from 'react';
import { LANGUAGE_LABELS, type QuestionLanguage } from '@iace/contracts';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';
import { Kbd } from '@iace/ui';

/** A Mac prints Cmd where every other keyboard prints Ctrl; the editor answers to both. */
const MOD_KEY = navigator.userAgent.includes('Mac') ? 'Cmd' : 'Ctrl';

/** A keyboard-only tool says which keys, once, where it does not cost the box any room. */
export function Legend({
  language,
  questions = false,
  actions,
}: Readonly<{
  language: QuestionLanguage;
  /** Several questions to move between, not the one box. */
  questions?: boolean;
  /** The page's own buttons, at the bar's right end. */
  actions?: React.ReactNode;
}>) {
  return (
    <div className="flex flex-none items-center justify-between gap-4 border-t border-border bg-surface px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Shortcut keys={['↑', '↓']}>move</Shortcut>
        <Shortcut keys={['Enter']}>next</Shortcut>
        <Shortcut keys={[MOD_KEY, 'Enter']}>save and next</Shortcut>
        {questions ? <Shortcut keys={['Alt', '↑ ↓']}>previous / next question</Shortcut> : null}
        <Shortcut keys={['$…$']}>maths</Shortcut>
        <Shortcut keys={[MOD_KEY, 'V']}>paste an image</Shortcut>
        <Shortcut keys={['Alt', 'L']}>{LANGUAGE_LABELS[language]}</Shortcut>
      </div>
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function Shortcut({
  keys,
  children,
}: Readonly<{ keys: readonly string[]; children: React.ReactNode }>) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={`${key}:${index}`} className="flex items-center gap-1">
          {index > 0 ? <span aria-hidden>+</span> : null}
          <Kbd>{key}</Kbd>
        </span>
      ))}
      <span>{children}</span>
    </span>
  );
}

/** Escape and F11 raise the exit count, so leaving full screen is derived, not listened for. */
export function useFocusMode() {
  const fullscreen = useFullscreen();
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const immersive = focusedAt !== null && fullscreen.exits === focusedAt;
  useWorkspace(immersive);

  const toggle = () => {
    if (immersive) {
      setFocusedAt(null);
      void fullscreen.exit();
      return;
    }
    setFocusedAt(fullscreen.exits);
    void fullscreen.enter();
  };

  return { immersive, toggle };
}
