/**
 * The vendor's confirm box, which is what this screen interrupts itself with: a white
 * card over a dimmed paper, 12px bold, two flat blue buttons. Values from the
 * `#popup_container` and `.inputcnf` rules of the captured inline stylesheet.
 */
import { type ExamView } from '@iace/app-kit';

export function RailwayFullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <div className="rw-nag-overlay absolute inset-0 z-50 grid place-items-center p-6">
      <div className="rw-nag flex flex-col gap-5">
        <p>{says}</p>
        <div className="flex justify-end">
          <button type="button" className="rw-nag-btn" onClick={fullscreen.enter}>
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
