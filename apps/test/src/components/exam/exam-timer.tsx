import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { clockText, secondsLeft, type ExamClock } from '@iace/contracts';
import { cn } from '@iace/ui';

/** The countdown. It counts to the SERVER's deadline; the device clock only measures elapsed time. */

/** Under this the clock turns urgent — five minutes is the warning every exam hall gives. */
const URGENT_SEC = 5 * 60;

export function ExamTimer({
  clock,
  onExpire,
}: Readonly<{ clock: ExamClock; onExpire: () => void }>) {
  const [left, setLeft] = useState(() => secondsLeft(clock, Date.now()));

  useEffect(() => {
    const tick = setInterval(() => setLeft(secondsLeft(clock, Date.now())), 1000);
    return () => clearInterval(tick);
  }, [clock]);

  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

  return (
    <p
      aria-live="off"
      className={cn(
        'flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-semibold tabular-nums',
        left <= URGENT_SEC ? 'border-destructive text-destructive' : 'text-foreground',
      )}
    >
      <AlarmClock aria-hidden className="size-4" />
      <span className="sr-only">Time left</span>
      {clockText(left)}
    </p>
  );
}
