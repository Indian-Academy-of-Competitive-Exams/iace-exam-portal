/**
 * The frame every skin sits in. The full-screen warning and the submit
 * confirmation are here rather than in a template, so a new skin cannot ship
 * without them — and the data attribute is what scopes that skin's tokens.
 */
import { EXAM_TEMPLATE, EXAM_TEMPLATE_CONFIG, type ExamTemplate } from '@iace/contracts';
import { Alert, Button, ConfirmDialog, plural } from '@iace/ui';
import { type ExamView } from '@iace/app-kit';
import { Layout } from '../templates/shared/layout';
import { useLockedZoom } from './lock-zoom';
import { RailwayLayout } from '../templates/railway/layout';

export function ExamShell({
  examTemplate,
  view,
}: Readonly<{ examTemplate: ExamTemplate; view: ExamView }>) {
  const { submit, fullscreen } = view;
  useLockedZoom();
  // A skin nothing is configured for falls back rather than leaving a candidate on a blank page.
  const template = EXAM_TEMPLATE_CONFIG[examTemplate] ? examTemplate : EXAM_TEMPLATE.DEFAULT;
  const railway = template === EXAM_TEMPLATE.SSC_RAILWAYS;
  const Skin = railway ? RailwayLayout : Layout;

  return (
    <div
      // Lowercased for CSS, where the skin's whole palette hangs off this one attribute.
      data-exam-template={template.toLowerCase()}
      // A sitting is not a document to copy from: neither skin lets the paper be selected.
      className="relative flex h-dvh select-none flex-col bg-exam-surface text-exam-ink"
    >
      <Skin view={view} config={EXAM_TEMPLATE_CONFIG[template]} />

      {fullscreen.nagging ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-exam-surface/95 p-6">
          <div className="flex max-w-md flex-col gap-4">
            <Alert variant="danger">
              {`${leftFullScreen(fullscreen.exits)} Your paper is still running and the clock has not stopped.`}
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={fullscreen.enter}>
                Return to full screen
              </Button>
              <Button type="button" variant="ghost" onClick={fullscreen.ignore}>
                Carry on without it
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* The railway skin asks over the paper, as its original does; every other skin gets this. */}
      <ConfirmDialog
        open={submit.asking && !railway}
        onOpenChange={(open) => !open && submit.cancel()}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Submit this test?"
        description={`${plural(submit.unanswered, 'question')} unanswered and ${submit.markedForReview} marked for review. Once submitted the paper closes and nothing more can be changed.`}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={submit.confirm}
      />
    </div>
  );
}

/** Said once without a count, because "1 times" is how a screen tells a student it is a machine. */
function leftFullScreen(exits: number): string {
  return exits > 1 ? `You left full screen ${exits} times.` : 'You left full screen.';
}
