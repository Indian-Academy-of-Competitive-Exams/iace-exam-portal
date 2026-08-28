/**
 * The frame every skin sits in. The full-screen warning and the submit
 * confirmation are here rather than in a template, so a new skin cannot ship
 * without them — and the data attribute is what scopes that skin's tokens.
 */
import { Alert, Button, ConfirmDialog, plural } from '@iace/ui';
import type { ExamView } from './exam-view';
import type { ExamTemplateDefinition } from './template';

export function ExamShell({
  template,
  view,
}: Readonly<{ template: ExamTemplateDefinition; view: ExamView }>) {
  const { submit, fullscreen } = view;

  return (
    <div
      // Lowercased for CSS, where the skin's whole palette hangs off this one attribute.
      data-exam-template={template.id.toLowerCase()}
      className="relative flex h-dvh flex-col bg-exam-surface text-exam-ink"
    >
      <template.Layout view={view} config={template.config} slots={template.slots} />

      {fullscreen.nagging ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-exam-surface/95 p-6">
          <div className="flex max-w-md flex-col gap-4">
            <Alert variant="danger">
              {`${leftFullScreen(fullscreen.exits)} Your paper is still running and the clock has not stopped. Leaving full screen is recorded on this sitting.`}
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

      <ConfirmDialog
        open={submit.asking}
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
