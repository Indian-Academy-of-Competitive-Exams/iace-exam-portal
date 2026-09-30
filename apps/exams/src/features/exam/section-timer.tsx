import { Hourglass } from 'lucide-react';
import { clockText } from '@iace/contracts';
import { cn } from '@iace/ui';
import { useAnchoredCountdown } from '@iace/app-kit';

/** A section's own clock, keyed by the section: entering one starts it and nothing else has to. */

/** Under a minute the section is about to close, which is the warning an exam hall gives. */
const URGENT_SEC = 60;

export function SectionTimer({
  allowedSec,
  onExpire,
  labelled = false,
}: Readonly<{ allowedSec: number; onExpire: () => void; labelled?: boolean }>) {
  const left = useAnchoredCountdown(allowedSec, onExpire);

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
