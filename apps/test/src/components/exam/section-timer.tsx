import { useEffect, useRef, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { clockText } from '@iace/contracts';
import { cn } from '@iace/ui';

/** A section's own clock, keyed by the section: entering one starts it and nothing else has to. */

/** Under a minute the section is about to close, which is the warning an exam hall gives. */
const URGENT_SEC = 60;

export function SectionTimer({
  allowedSec,
  onExpire,
}: Readonly<{ allowedSec: number; onExpire: () => void }>) {
  const [left, setLeft] = useState(allowedSec);
  // A timestamp, not a decrementing counter: a backgrounded tab must not buy a student time.
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      const since = startedAt.current === 0 ? Date.now() : startedAt.current;
      setLeft(Math.max(0, allowedSec - Math.round((Date.now() - since) / 1000)));
    }, 1000);
    return () => clearInterval(tick);
  }, [allowedSec]);

  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

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
