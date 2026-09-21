import { useCallback, useEffect, useRef } from 'react';
import { Hourglass } from 'lucide-react';
import { clockText } from '@iace/contracts';
import { cn } from '@iace/ui';
import { useCountdown } from '@iace/app-kit';

/** A section's own clock, keyed by the section: entering one starts it and nothing else has to. */

/** Under a minute the section is about to close, which is the warning an exam hall gives. */
const URGENT_SEC = 60;

export function SectionTimer({
  allowedSec,
  onExpire,
  labelled = false,
}: Readonly<{ allowedSec: number; onExpire: () => void; labelled?: boolean }>) {
  // A timestamp, not a decrementing counter: a backgrounded tab must not buy a student time.
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const left = useCountdown(
    useCallback(() => {
      const since = startedAt.current === 0 ? Date.now() : startedAt.current;
      return Math.max(0, allowedSec - Math.round((Date.now() - since) / 1000));
    }, [allowedSec]),
    onExpire,
  );

  return (
    <p
      aria-live="off"
      className={cn(
        'flex items-center gap-2 rounded-exam-option border px-3 py-1.5 text-sm font-semibold tabular-nums',
        left <= URGENT_SEC
          ? 'border-exam-timer-urgent-border bg-exam-timer-urgent text-exam-timer-urgent-ink'
          : 'border-exam-timer-border bg-exam-timer-bg text-exam-timer-ink',
      )}
    >
      {labelled ? null : <Hourglass aria-hidden className="size-4" />}
      <span className={labelled ? 'font-normal' : 'sr-only'}>Time left in this section</span>
      {clockText(left)}
    </p>
  );
}
