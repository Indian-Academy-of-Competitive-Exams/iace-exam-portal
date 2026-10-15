import { type ReactNode } from 'react';
import { PAUSE_SAYS, type usePause, type ExamView } from '@iace/app-kit';
import { cn } from '@iace/ui';
import { MODAL_BOX, useModalBox } from '../../use-modal-box';

export function SscPauseBox({ pause }: Readonly<{ pause: ReturnType<typeof usePause> }>) {
  return (
    <SscBox label="Pause Test" says={pause.says}>
      <button type="button" disabled={pause.pending} onClick={pause.confirm}>
        {PAUSE_SAYS.confirm}
      </button>
      <button type="button" autoFocus onClick={pause.cancel}>
        Carry on
      </button>
    </SscBox>
  );
}

/** The one box this screen says things in: a line of text over its buttons on a grey foot. */
function SscBox({
  label,
  says,
  children,
}: Readonly<{ label: string; says: string; children: ReactNode }>) {
  const box = useModalBox<HTMLDialogElement>();

  return (
    <div className="sc-overlay absolute inset-0 z-50 grid place-items-center p-4">
      <dialog ref={box} open aria-modal aria-label={label} className={cn(MODAL_BOX, 'sc-nag')}>
        <p>{says}</p>
        <div className="flex flex-wrap items-center justify-end">{children}</div>
      </dialog>
    </div>
  );
}

export function SscFullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <SscBox label="Full screen" says={says}>
      <button type="button" autoFocus onClick={fullscreen.enter}>
        Return to full screen
      </button>
      <button type="button" onClick={fullscreen.ignore}>
        Carry on without it
      </button>
    </SscBox>
  );
}
