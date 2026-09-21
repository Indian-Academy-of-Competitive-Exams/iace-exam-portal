/** DEV only: the railway skin on a standing paper, for looking at the screen without a sitting. */
import { EXAM_TEMPLATE } from '@iace/contracts';
import { ExamShell } from '../components/exam/engine/exam-shell';
import { previewView } from '../components/exam/templates/railway/preview-data';

export function RailwayPreviewPage() {
  return <ExamShell examTemplate={EXAM_TEMPLATE.SSC_RAILWAYS} view={previewView()} />;
}
