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
  labelled = false,
}: Readonly<{ clock: ExamClock; onExpire: () => void; labelled?: boolean }>) {
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
        'flex items-center gap-2 rounded-exam-option border px-3 py-1.5 text-sm font-semibold tabular-nums',
        left <= URGENT_SEC
          ? 'border-exam-timer-urgent-border bg-exam-timer-urgent text-exam-timer-urgent-ink'
          : 'border-exam-timer-border bg-exam-timer-bg text-exam-timer-ink',
      )}
    >
      {labelled ? null : <AlarmClock aria-hidden className="size-4" />}
      <span className={labelled ? 'font-normal' : 'sr-only'}>Time left</span>
      {clockText(left)}
    </p>
  );
}
