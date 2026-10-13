/**
 * The vendor's confirm box, which is what this screen interrupts itself with: a white
 * card over a dimmed paper, 12px bold, two flat blue buttons. Values from the
 * `#popup_container` and `.inputcnf` rules of the captured inline stylesheet.
 */
import { PAUSE_SAYS, type ExamView, type usePause } from '@iace/app-kit';

export function RailwayFullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <div className="rw-nag-overlay absolute inset-0 z-50 grid place-items-center p-6">
      <div className="rw-nag flex flex-col gap-5">
        <p>{says}</p>
        <div className="flex justify-end">
          <button type="button" autoFocus className="rw-nag-btn" onClick={fullscreen.enter}>
            Return to full screen
          </button>
          <button type="button" className="rw-nag-btn" onClick={fullscreen.ignore}>
            Carry on without it
          </button>
        </div>
      </div>
    </div>
  );
}

/** The same box, asking before a sitting is left to be come back to. */
export function RailwayPauseBox({ pause }: Readonly<{ pause: ReturnType<typeof usePause> }>) {
  return (
    <div className="rw-nag-overlay absolute inset-0 z-50 grid place-items-center p-6">
      <div
        role="dialog"
        aria-modal
        aria-label={PAUSE_SAYS.title}
        className="rw-nag flex flex-col gap-5"
      >
        <p>{pause.says}</p>
        <div className="flex justify-end">
          <button
            type="button"
            className="rw-nag-btn"
            disabled={pause.pending}
            onClick={pause.confirm}
          >
            {PAUSE_SAYS.confirm}
          </button>
          <button type="button" autoFocus className="rw-nag-btn" onClick={pause.cancel}>
            Carry on
          </button>
        </div>
      </div>
    </div>
  );
}
