/** DEV only: a copied skin on a standing paper, for looking at the screens without a sitting. */
import { useState } from 'react';
import { EXAM_TEMPLATE, type ExamTemplate } from '@iace/contracts';
import { ExamShell } from './exam-shell';
import { InstructionsShell } from './instructions-shell';
import { previewBrief, previewView } from './templates/railway/preview-data';

export function RailwayPreviewPage({
  template = EXAM_TEMPLATE.RAILWAYS,
}: Readonly<{ template?: ExamTemplate }>) {
  const [begun, setBegun] = useState(false);
  const [asking, setAsking] = useState(false);

  if (!begun) {
    return (
      <InstructionsShell
        brief={{ ...previewBrief(), examTemplate: template }}
        fullscreenSupported
        onBegin={() => setBegun(true)}
      />
    );
  }

  const view = previewView();

  return (
    <ExamShell
      examTemplate={template}
      onPause={() => undefined}
      calculatorEnabled
      view={{
        ...view,
        // The only callbacks the preview wires: the submit screen is unreachable otherwise.
        submit: {
          ...view.submit,
          asking,
          ask: () => setAsking(true),
          cancel: () => setAsking(false),
          confirm: () => setAsking(false),
        },
      }}
    />
  );
}
