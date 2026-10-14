import type { ReactNode } from 'react';
import type { ExamClock } from '@iace/contracts';
import { TIMER_KIND, useAnchoredCountdown, useClockCountdown, type ExamView } from '@iace/app-kit';

export function Countdown({
  view: { timer },
  children,
}: Readonly<{ view: ExamView; children: (left: number) => ReactNode }>) {
  return timer.kind === TIMER_KIND.SECTION ? (
    <SectionCountdown key={timer.key} allowedSec={timer.allowedSec} onExpire={timer.onExpire}>
      {children}
    </SectionCountdown>
  ) : (
    <PaperCountdown clock={timer.clock} onExpire={timer.onExpire}>
      {children}
    </PaperCountdown>
  );
}

function PaperCountdown({
  clock,
  onExpire,
  children,
}: Readonly<{ clock: ExamClock; onExpire: () => void; children: (left: number) => ReactNode }>) {
  return children(useClockCountdown(clock, onExpire));
}

function SectionCountdown({
  allowedSec,
  onExpire,
  children,
}: Readonly<{ allowedSec: number; onExpire: () => void; children: (left: number) => ReactNode }>) {
  return children(useAnchoredCountdown(allowedSec, onExpire));
}
