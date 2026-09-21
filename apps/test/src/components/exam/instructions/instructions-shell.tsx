/**
 * The frame the pre-test steps sit in. It is where the skin is chosen, the same way
 * ExamShell chooses one for the sitting, so a candidate reads the paper's own screens
 * before it opens rather than the default ones and then a different sitting.
 */
import { EXAM_TEMPLATE, type ExamBrief, type LanguageCode } from '@iace/contracts';
import { DefaultInstructions } from './default-instructions';
import { RailwayInstructions } from '../templates/railway/instructions';
import { useInstructions } from './use-instructions';

export function InstructionsShell({
  brief,
  fullscreenSupported,
  onBegin,
}: Readonly<{
  brief: ExamBrief;
  fullscreenSupported: boolean;
  onBegin: (languages: readonly LanguageCode[]) => void;
}>) {
  const view = useInstructions(brief, onBegin);

  if (brief.examTemplate === EXAM_TEMPLATE.SSC_RAILWAYS) {
    return <RailwayInstructions view={view} />;
  }

  return <DefaultInstructions view={view} fullscreenSupported={fullscreenSupported} />;
}
