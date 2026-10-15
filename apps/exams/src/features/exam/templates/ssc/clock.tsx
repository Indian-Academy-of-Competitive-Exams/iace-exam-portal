import profileImage from '../railway/assets/profile.png';
import { CirclePause } from 'lucide-react';
import { type ExamView } from '@iace/app-kit';
import { Countdown } from '../shared/countdown';

/** The original starts at its smallest and grows a tenth at a time to double. */
const FONT_STEP = { MIN: 0, MAX: 10 } as const;

type Fullscreen = ExamView['fullscreen'];

/** The header's own tools: the two zoom steps and the way into full screen. */
export function SscTools({
  fontStep,
  onStep,
  fullscreen,
}: Readonly<{ fontStep: number; onStep: (step: number) => void; fullscreen: Fullscreen }>) {
  return (
    <div className="sc-tools flex flex-col items-center">
      <div className="flex">
        <button
          type="button"
          className="sc-zoom"
          disabled={fontStep >= FONT_STEP.MAX}
          onClick={() => onStep(fontStep + 1)}
        >
          Zoom (+)
        </button>
        <button
          type="button"
          className="sc-zoom"
          disabled={fontStep <= FONT_STEP.MIN}
          onClick={() => onStep(fontStep - 1)}
        >
          Zoom (−)
        </button>
      </div>
      {fullscreen.isSupported && !fullscreen.isFullscreen ? (
        <button type="button" className="sc-fullscreen" onClick={fullscreen.enter}>
          Enter Full Screen
        </button>
      ) : null}
    </div>
  );
}

export function SscClock({ view, onPause }: Readonly<{ view: ExamView; onPause?: () => void }>) {
  return (
    <div className="sc-clock flex shrink-0">
      <div>
        <SscTimer view={view} />
        {onPause ? (
          <button
            type="button"
            className="sc-pause flex items-center"
            disabled={view.locked !== null}
            onClick={onPause}
          >
            <CirclePause aria-hidden />
            Pause Test
          </button>
        ) : null}
      </div>
      <img src={profileImage} alt="" />
    </div>
  );
}

export function SscTimer({ view }: Readonly<{ view: ExamView }>) {
  return <Countdown view={view}>{(left) => <TimeLeft left={left} />}</Countdown>;
}

function TimeLeft({ left }: Readonly<{ left: number }>) {
  return (
    <p aria-live="off" className="sc-timer">
      Time Left: <b>{minuteClock(left)}</b>
    </p>
  );
}

/** "14:57", and "120:00" for a two-hour paper — this screen never shows an hours place. */
function minuteClock(left: number): string {
  const safe = Math.max(0, left);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(safe / 60))}:${two(safe % 60)}`;
}
