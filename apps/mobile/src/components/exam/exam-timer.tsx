/**
 * The paper's clock and a section's. Both are re-read from a timestamp every
 * tick rather than counted down, so a phone that suspended its timers in the
 * background comes back to the true time, and `secondsLeft` clamps at zero so
 * a clock that jumped past it still expires.
 */
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { clockText, secondsLeft, type ExamClock } from '@iace/contracts';
import { useAnchoredCountdown, useCountdown } from '@iace/app-kit';
import { cn } from '../../lib/cn';

/** Under this the clock turns urgent — five minutes is the warning every exam hall gives. */
const URGENT_SEC = 5 * 60;

/** Under a minute a section is about to close. */
const SECTION_URGENT_SEC = 60;

export function ExamTimer({
  clock,
  onExpire,
}: Readonly<{ clock: ExamClock; onExpire: () => void }>) {
  // Keyed on the values, not the object the engine rebuilds every render, so a tap never resets the tick.
  const { endsAt, serverNow, arrivedAt } = clock;
  const left = useCountdown(
    useCallback(
      () => secondsLeft({ endsAt, serverNow, arrivedAt }, Date.now()),
      [endsAt, serverNow, arrivedAt],
    ),
    onExpire,
  );
  const urgent = left <= URGENT_SEC;

  return (
    <View
      accessibilityLabel={`Time left ${clockText(left)}`}
      className={cn(
        'h-11 justify-center rounded-exam-option border px-3',
        urgent
          ? 'border-exam-timer-urgent-border bg-exam-timer-urgent'
          : 'border-exam-timer-border bg-exam-timer-bg',
      )}
    >
      <Text
        className={cn(
          'text-base font-semibold tabular-nums',
          urgent ? 'text-exam-timer-urgent-ink' : 'text-exam-timer-ink',
        )}
      >
        {clockText(left)}
      </Text>
    </View>
  );
}

/** Keyed by the section by its caller: entering one starts it and nothing else has to. */
export function SectionTimer({
  allowedSec,
  onExpire,
}: Readonly<{ allowedSec: number; onExpire: () => void }>) {
  const left = useAnchoredCountdown(allowedSec, onExpire);

  return (
    <View
      accessibilityLabel={`Time left in this section ${clockText(left)}`}
      className={cn(
        'h-11 justify-center rounded-exam-option border px-3',
        left <= SECTION_URGENT_SEC
          ? 'border-exam-timer-urgent-border bg-exam-timer-urgent'
          : 'border-exam-timer-border bg-exam-timer-bg',
      )}
    >
      <Text
        className={cn(
          'text-base font-semibold tabular-nums',
          left <= SECTION_URGENT_SEC ? 'text-exam-timer-urgent-ink' : 'text-exam-timer-ink',
        )}
      >
        {clockText(left)}
      </Text>
    </View>
  );
}
