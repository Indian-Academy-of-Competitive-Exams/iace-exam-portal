import { useEffect, useState } from 'react';
import { AppException, ErrorCodes } from '@iace/contracts';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';
import { ChevronUp } from 'lucide-react';
import { EmptyState, EMPTY_STATE_KINDS, KEY_NAMES, Shortcut, cn } from '@iace/ui';
import { TOUR_TARGETS } from '../../lib/tours';
import { ChecksList, ChecksStatus, type Check } from './authoring-preview';

const { MOD: MOD_KEY, ALT: ALT_KEY } = KEY_NAMES;

/** A keyboard-only tool says which keys, once, on one line that costs the box no room. */
export function Legend({
  questions = false,
  checks,
  actions,
}: Readonly<{
  /** Several questions to move between, not the one box. */
  questions?: boolean;
  /** The shown question's validation: badges on the bar, the list opening upward above it. */
  checks?: readonly Check[];
  /** The page's own buttons, at the bar's right end. */
  actions?: React.ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-none flex-col border-t border-border bg-surface">
      {checks && open ? (
        <div
          id={VALIDATION_PANEL}
          className="relative max-h-64 overflow-y-auto border-b border-border px-4 py-3"
        >
          <ChecksList checks={checks} />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4 px-4 py-2">
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
          <Shortcut keys={[ALT_KEY, 'M']}>equation</Shortcut>
          <Shortcut keys={[ALT_KEY, 'T']}>table</Shortcut>
        </div>
        {checks || actions ? (
          <div
            data-tour={TOUR_TARGETS.AUTHORING_ACTIONS}
            className="flex flex-none items-center gap-2"
          >
            {checks ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={VALIDATION_PANEL}
                onClick={() => setOpen((was) => !was)}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none"
              >
                <ChevronUp
                  className={cn(
                    'size-4 text-muted-foreground transition-transform',
                    open && 'rotate-180',
                  )}
                  aria-hidden
                />
                Validation
                <ChecksStatus checks={checks} />
              </button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const VALIDATION_PANEL = 'authoring-validation';

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

  // One way out for the toggle and for a page that goes away while immersive: the browser leaves with the chrome.
  const { exit } = fullscreen;
  useEffect(() => (immersive ? () => void exit() : undefined), [immersive, exit]);

  const toggle = () => {
    if (immersive) return setFocusedAt(null);
    setFocusedAt(fullscreen.exits);
    void fullscreen.enter();
  };

  return { immersive, toggle };
}
