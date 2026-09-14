import { useCallback, useEffect, useRef } from 'react';
import { Hourglass } from 'lucide-react';
import { clockText } from '@iace/contracts';
import { cn } from '@iace/ui';
import { useCountdown } from './use-countdown';

/** A section's own clock, keyed by the section: entering one starts it and nothing else has to. */

/** Under a minute the section is about to close, which is the warning an exam hall gives. */
const URGENT_SEC = 60;

export function SectionTimer({
  allowedSec,
  onExpire,
}: Readonly<{ allowedSec: number; onExpire: () => void }>) {
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
      className={cn(
        'flex items-center gap-1.5 text-xs font-semibold tabular-nums',
        left <= URGENT_SEC ? 'text-exam-timer-urgent-border' : 'text-exam-ink-muted',
      )}
    >
      <Hourglass aria-hidden className="size-3.5" />
      <span className="sr-only">Time left in this section</span>
      {clockText(left)}
    </p>
  );
}
