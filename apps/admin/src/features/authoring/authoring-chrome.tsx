import { useState } from 'react';
import { AppException, ErrorCodes } from '@iace/contracts';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';
import { EmptyState, EMPTY_STATE_KINDS, Kbd } from '@iace/ui';
import { KEY_NAMES } from '../../lib/constants';
import { TOUR_TARGETS } from '../../lib/tours';

const { MOD: MOD_KEY, ALT: ALT_KEY } = KEY_NAMES;

/** A keyboard-only tool says which keys, once, on one line that costs the box no room. */
export function Legend({
  questions = false,
  actions,
}: Readonly<{
  /** Several questions to move between, not the one box. */
  questions?: boolean;
  /** The page's own buttons, at the bar's right end. */
  actions?: React.ReactNode;
}>) {
  return (
    <div className="flex flex-none items-center justify-between gap-4 border-t border-border bg-surface px-4 py-2">
      <div
        data-tour={TOUR_TARGETS.AUTHORING_KEYS}
        className="flex min-w-0 items-center gap-x-4 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
      >
        <Shortcut keys={['↑↓']}>move</Shortcut>
        <Shortcut keys={['Enter']}>next</Shortcut>
        <Shortcut keys={[MOD_KEY, 'Enter']}>save</Shortcut>
        {questions ? <Shortcut keys={[ALT_KEY, '↑↓']}>question</Shortcut> : null}
        <Shortcut keys={['$…$']}>maths</Shortcut>
        <Shortcut keys={[MOD_KEY, 'V']}>image</Shortcut>
        <Shortcut keys={[ALT_KEY, 'L']}>language</Shortcut>
      </div>
      {actions ? (
        <div
          data-tour={TOUR_TARGETS.AUTHORING_ACTIONS}
          className="flex flex-none items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function Shortcut({
  keys,
  children,
}: Readonly<{ keys: readonly string[]; children: React.ReactNode }>) {
  return (
    <span className="flex flex-none items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}

/** In place of a question that was not read: refused where the server says it is not theirs, else a failure to retry. */
export function QuestionNotLoaded({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry: () => void }>) {
  const refused =
    AppException.is(error) &&
    (error.code === ErrorCodes.FORBIDDEN || error.code === ErrorCodes.NOT_FOUND);
  if (refused) {
    return <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This question is not open to you" />;
  }
  return (
    <EmptyState
      kind={EMPTY_STATE_KINDS.FAILURE}
      title="Could not load this question"
      onRetry={onRetry}
    />
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
