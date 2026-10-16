/**
 * The SSC skin: the clock in the header, the section and four buttons above the question,
 * and a palette of small coloured chips on the right. Every value and callback comes off
 * the view, as in the other skins, so only the markup and the class names differ.
 */
import { useState, type CSSProperties } from 'react';
import { mayPause, usePause, type ExamView } from '@iace/app-kit';
import { useMediaQuery } from '@iace/app-kit/browser';
import { Alert, Button } from '@iace/ui';
import { PaperWatermark, type ExamSlotProps } from '../shared/slots';
import { PHONE_QUERY } from '../shared/phone-query';
import { SscGuide, SscHeader } from './instructions';
import { SscBand } from './band';
import { READING, type Reading } from './states';
import { SscClock, SscTools } from './clock';
import { SscPauseBox } from './modals';
import { SscSide } from './palette';
import { SscPaper } from './question';
import { SscLeaving } from './submit-summary';
import './ssc.css';

export { SscFullscreenNag } from './modals';

export function SscLayout({ view, config, onOpenCalculator, onPause }: Readonly<ExamSlotProps>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(!phone);
  const [reading, setReading] = useState<Reading | null>(null);
  const [fontStep, setFontStep] = useState(0);
  const pause = usePause(onPause, mayPause(view));
  // Held by id, so a clock that closes the section first takes the question about it away too.
  const [handingIn, setHandingIn] = useState<string | null>(null);
  const { submitSection, fullscreen } = view;
  const leavingSection = submitSection !== null && handingIn === view.sectionId;
  const leavingPaper = view.submit.asking || view.submit.isPending;
  // Over the paper the palette hides the question it just opened, so opening one puts it away.
  const openQuestion = (questionId: string) => {
    view.openQuestion(questionId);
    if (phone) setPaletteOpen(false);
  };

  return (
    <div
      className="sc-screen relative flex min-h-0 flex-1 flex-col"
      style={{ '--sc-font-step': fontStep } as CSSProperties}
    >
      <SscHeader
        title={view.title}
        tools={<SscTools fontStep={fontStep} onStep={setFontStep} fullscreen={fullscreen} />}
      >
        <SscClock view={view} onPause={onPause ? pause.ask : undefined} />
      </SscHeader>

      {view.submit.failed ? (
        <Alert variant="danger" className="flex shrink-0 items-center justify-between gap-2">
          Could not submit this paper.
          <Button type="button" variant="outline" size="sm" onClick={view.submit.retry}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {leavingSection || leavingPaper ? (
        <SscLeaving view={view} ofSection={leavingSection} onClose={() => setHandingIn(null)} />
      ) : (
        <>
          <SscBand
            view={view}
            reading={reading}
            onRead={setReading}
            onOpenCalculator={onOpenCalculator}
            onHandIn={() => setHandingIn(view.sectionId)}
          />

          <div
            className="relative flex min-h-0 flex-1"
            data-palette-open={paletteOpen || undefined}
          >
            <SscLeft view={view} reading={reading} onBack={() => setReading(null)} />

            <SscSide
              view={view}
              open={paletteOpen}
              onToggle={() => setPaletteOpen((open) => !open)}
              onOpen={openQuestion}
            />
          </div>
        </>
      )}

      {pause.asking ? <SscPauseBox pause={pause} /> : null}

      <PaperWatermark view={view} config={config} className="sc-watermark" />
    </div>
  );
}

/** The left of the screen: the guide while it is being read, the paper otherwise. */
function SscLeft({
  view,
  reading,
  onBack,
}: Readonly<{ view: ExamView; reading: Reading | null; onBack: () => void }>) {
  return (
    <div className="sc-left flex min-w-0 flex-1 flex-col">
      {reading ? (
        <>
          {/* Keyed, so asking for the symbols after the instructions scrolls to them again. */}
          <div key={reading} className="sc-guide min-h-0 flex-1">
            <SscGuide
              sections={view.sections}
              forwardOnly={view.forwardOnly}
              sectional={view.sectional}
              startAtSymbols={reading === READING.SYMBOLS}
            />
          </div>
          <button type="button" className="sc-back" onClick={onBack}>
            Back
          </button>
        </>
      ) : (
        <SscPaper view={view} />
      )}
    </div>
  );
}
