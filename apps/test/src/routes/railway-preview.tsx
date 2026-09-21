/** DEV only: the railway skin on a standing paper, for looking at the screens without a sitting. */
import { useState } from 'react';
import { EXAM_TEMPLATE } from '@iace/contracts';
import { ExamShell } from '../components/exam/engine/exam-shell';
import { InstructionsShell } from '../components/exam/instructions/instructions-shell';
import { previewBrief, previewView } from '../components/exam/templates/railway/preview-data';

export function RailwayPreviewPage() {
  const [begun, setBegun] = useState(false);
  const [asking, setAsking] = useState(false);

  if (!begun) {
    return (
      <InstructionsShell
        brief={previewBrief()}
        fullscreenSupported
        onBegin={() => setBegun(true)}
      />
    );
  }

  const view = previewView();

  return (
    <ExamShell
      examTemplate={EXAM_TEMPLATE.SSC_RAILWAYS}
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
