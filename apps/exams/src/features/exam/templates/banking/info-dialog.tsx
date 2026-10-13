/** The banking screen's small "Info" box: a blue bar, a line of text, and its buttons on a tinted foot. */
import { type ReactNode } from 'react';
import { PAUSE_SAYS, type ExamView } from '@iace/app-kit';

function InfoDialog({
  title = 'Info',
  onClose,
  wide,
  children,
  foot,
}: Readonly<{
  title?: string;
  onClose?: () => void;
  wide?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}>) {
  return (
    <div className="bk-overlay absolute inset-0 z-50 grid place-items-center p-4">
      <div role="dialog" aria-modal aria-label={title} className="bk-info" data-wide={wide}>
        <div className="bk-info-head flex items-center justify-between">
          <span>{title}</span>
          {onClose ? (
            <button type="button" onClick={onClose}>
              Close x
            </button>
          ) : null}
        </div>
        <div className="bk-info-body">{children}</div>
        {foot ? <div className="bk-info-foot flex justify-center gap-2">{foot}</div> : null}
      </div>
    </div>
  );
}

export function BankingFullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <InfoDialog
      foot={
        <>
          <button type="button" autoFocus className="bk-info-yes" onClick={fullscreen.enter}>
            Return to full screen
          </button>
          <button type="button" className="bk-info-no" onClick={fullscreen.ignore}>
            Carry on without it
          </button>
        </>
      }
    >
      {says}
    </InfoDialog>
  );
}

/** The in-test instructions: the same box, as tall as the paper allows, scrolling inside itself. */
export function BankingInstructionsDialog({
  onClose,
  children,
}: Readonly<{ onClose: () => void; children: ReactNode }>) {
  return (
    <InfoDialog title="Instructions" wide onClose={onClose}>
      {children}
    </InfoDialog>
  );
}

export function BankingPauseDialog({
  onPause,
  onCancel,
}: Readonly<{ onPause: () => void; onCancel: () => void }>) {
  return (
    <InfoDialog
      foot={
        <>
          <button type="button" autoFocus className="bk-info-yes" onClick={onPause}>
            {PAUSE_SAYS.confirm}
          </button>
          <button type="button" className="bk-info-no" onClick={onCancel}>
            Carry on
          </button>
        </>
      }
    >
      {PAUSE_SAYS.hint}
    </InfoDialog>
  );
}
