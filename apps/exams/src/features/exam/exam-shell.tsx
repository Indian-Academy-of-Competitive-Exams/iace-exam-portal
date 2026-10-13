/**
 * The frame every skin sits in. The full-screen warning and the submit
 * confirmation are here rather than in a template, so a new skin cannot ship
 * without them — and the data attribute is what scopes that skin's tokens.
 */
import { useState, type ReactNode } from 'react';
import { EXAM_TEMPLATE, EXAM_TEMPLATE_CONFIG, type ExamTemplate } from '@iace/contracts';
import { Alert, Button, Calculator, ConfirmDialog } from '@iace/ui';
import { submittingSays, type ExamView } from '@iace/app-kit';
import { Layout } from './templates/shared/layout';
import { type ExamSlotProps } from './templates/shared/slots';
import { useLockedZoom } from './lock-zoom';
import { useNetworkStatus } from './use-network-status';
import { RailwayLayout } from './templates/railway/layout';
import { RailwayFullscreenNag } from './templates/railway/fullscreen-nag';
import { BankingLayout } from './templates/banking/layout';
import { BankingFullscreenNag } from './templates/banking/info-dialog';

export function ExamShell({
  examTemplate,
  calculatorEnabled,
  view,
}: Readonly<{ examTemplate: ExamTemplate; calculatorEnabled: boolean; view: ExamView }>) {
  const { submit, fullscreen } = view;
  const [calculating, setCalculating] = useState(false);
  const online = useNetworkStatus();
  useLockedZoom();
  // A skin nothing is configured for falls back rather than leaving a candidate on a blank page.
  const template = EXAM_TEMPLATE_CONFIG[examTemplate] ? examTemplate : EXAM_TEMPLATE.DEFAULT;
  const { Skin, Nag, asksItself } = SKINS[template];

  return (
    <div
      // Lowercased for CSS, where the skin's whole palette hangs off this one attribute.
      data-exam-template={template.toLowerCase()}
      // A sitting is not a document to copy from: neither skin lets the paper be selected.
      className="relative flex h-dvh select-none flex-col bg-exam-surface text-exam-ink"
    >
      {!online || view.hasUnsaved ? (
        <Alert variant="warning" className="mx-3 mt-2 shrink-0">
          {!online
            ? 'Your connection is offline. You can continue the test; answers will sync when it returns. Keep this page open.'
            : 'Your answers have not reached the server yet. They will be retried automatically. Keep this page open.'}
        </Alert>
      ) : null}

      {/* Inert under the full-screen warning, or Tab and Space still answer the paper behind it. */}
      <div inert={fullscreen.nagging} className="flex min-h-0 flex-1 flex-col">
        <Skin
          view={view}
          config={EXAM_TEMPLATE_CONFIG[template]}
          onOpenCalculator={calculatorEnabled ? () => setCalculating(true) : undefined}
        />

        {/* Mounted here, not in a skin, so a config that offers one cannot be drawn without it. */}
        {calculating ? <Calculator onClose={() => setCalculating(false)} /> : null}
      </div>

      {fullscreen.nagging ? <Nag fullscreen={fullscreen} says={nagSays(fullscreen.exits)} /> : null}

      {/* A skin copied from a real CBT asks the way its original does; the default one gets this. */}
      <ConfirmDialog
        open={submit.asking && !asksItself}
        onOpenChange={(open) => !open && submit.cancel()}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Submit this test?"
        description={submittingSays(view)}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={submit.confirm}
      />
    </div>
  );
}

/** One row per template, so a new skin cannot be added without its warning and its way of asking. */
const SKINS: Readonly<
  Record<
    ExamTemplate,
    {
      Skin: (props: ExamSlotProps) => ReactNode;
      Nag: (props: { fullscreen: ExamView['fullscreen']; says: string }) => ReactNode;
      asksItself: boolean;
    }
  >
> = {
  [EXAM_TEMPLATE.DEFAULT]: { Skin: Layout, Nag: FullscreenNag, asksItself: false },
  [EXAM_TEMPLATE.RAILWAYS]: { Skin: RailwayLayout, Nag: RailwayFullscreenNag, asksItself: true },
  [EXAM_TEMPLATE.BANKING]: { Skin: BankingLayout, Nag: BankingFullscreenNag, asksItself: true },
};

/** The default skin's warning: the design system's own alert, over the paper it interrupts. */
function FullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-exam-surface/95 p-6">
      <div className="flex max-w-md flex-col gap-4">
        <Alert variant="danger">{says}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button type="button" autoFocus onClick={fullscreen.enter}>
            Return to full screen
          </Button>
          <Button type="button" variant="ghost" onClick={fullscreen.ignore}>
            Carry on without it
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Said once without a count, because "1 times" is how a screen tells a student it is a machine. */
function nagSays(exits: number): string {
  const left = exits > 1 ? `You left full screen ${exits} times.` : 'You left full screen.';
  return `${left} Your paper is still running and the clock has not stopped.`;
}
