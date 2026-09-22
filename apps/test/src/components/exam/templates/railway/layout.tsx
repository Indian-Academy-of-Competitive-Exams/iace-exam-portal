/**
 * The SSC/Railway skin. It fills the same slots as the default one and takes every
 * value and callback off the view — only the markup and the class names differ, so
 * the two skins cannot drift into behaving differently.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isReviewState, secondsLeft, type ExamClock } from '@iace/contracts';
import { useCountdown, type ExamView } from '@iace/app-kit';
import { cn } from '@iace/ui';
import { RailwayOptions, RailwayQuestion } from './question';
import { LEGEND_ORDER, TALLY_ORDER } from './states';
import { type ExamSlotProps } from '../shared/slots';
import { RailwayPalette } from './palette';
import { InfoTally } from './info-popup';
import { PaperModal, InstructionsModal } from './modals';
import { ScrollPane } from './scroll-pane';
import { RailwaySubmitSummary } from './submit-summary';
import './railway.css';

export function RailwayLayout({ view }: Readonly<ExamSlotProps>) {
  const [openPanel, setOpenPanel] = useState<'PAPER' | 'INSTRUCTIONS' | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  // The original answers Submit by taking the question area over and folding the palette away.
  const asking = view.submit.asking;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rw-header flex items-center justify-center">
        <span className="rw-logo">IACE</span>
      </div>

      <div className="rw-utilitybar flex items-center justify-end gap-6 px-4">
        <button
          type="button"
          className="flex items-center gap-2"
          onClick={() => setOpenPanel('PAPER')}
        >
          <span className="rw-icon questionpaper_icon" aria-hidden />
          Question paper
        </button>
        <button
          type="button"
          className="flex items-center gap-2"
          onClick={() => setOpenPanel('INSTRUCTIONS')}
        >
          <span className="rw-icon instruction_icon" aria-hidden />
          Instruction
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="fixedquehdr shrink-0">
            <span className="rw-testname">
              {view.title}
              <InfoTally counts={view.counts} states={tallyOf(view)} label="Status for this test" />
            </span>
          </div>

          <div className="time-left-sect flex shrink-0 items-center justify-between">
            <span>Section</span>
            <RailwayTimer view={view} />
          </div>

          <div className="rw-sectionbar flex shrink-0 items-center gap-1 px-3 py-1">
            {view.sections.map((section) => (
              <span
                key={section.id}
                className={cn('subjcttab', section.id === view.sectionId && 'active')}
              >
                <button
                  type="button"
                  disabled={!view.reachable.includes(section.id)}
                  onClick={() => view.openSection(section.id)}
                >
                  {section.name}
                </button>
                <InfoTally
                  counts={view.sectionCounts[section.id] ?? view.counts}
                  states={tallyOf(view)}
                  label={`Status for ${section.name}`}
                />
              </span>
            ))}
          </div>

          <div className="new-tab-second flex shrink-0 items-center justify-between">
            <span className="rw-qtype">Question Type : Multiple Choice Question</span>
            <span className="rw-marks">
              Marks For Correct Answer: <em>1</em> | Negative Mark:{' '}
              <em className="rw-penalty">0.33</em>
            </span>
          </div>

          <div className="questn flex shrink-0 items-center justify-between">
            <span>{`Question No. ${view.questionIndex + 1}`}</span>
            <button type="button" className="fulscrnbtn" onClick={view.fullscreen.enter}>
              View Full Screen
            </button>
          </div>

          <ScrollPane className="min-h-0 flex-1">
            {asking ? <RailwaySubmitSummary view={view} /> : <RailwayPaper view={view} />}
          </ScrollPane>

          <div className={cn('rw-buttons flex items-center gap-2', asking && 'hidden')}>
            {view.forwardOnly ? null : (
              <button type="button" className="btn" onClick={view.markAndNext}>
                Mark for Review &amp; Next
              </button>
            )}
            <button type="button" className="btn" onClick={view.clearResponse}>
              Clear Response
            </button>
            <button type="button" className="savenext ml-auto" onClick={view.nextQuestion}>
              Save &amp; Next
            </button>
          </div>
        </div>

        <div className={cn('relative w-0 shrink-0', asking && 'hidden')}>
          <button
            type="button"
            aria-label={paletteOpen ? 'Collapse question palette' : 'Expand question palette'}
            className="rw-palette-toggle"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            {paletteOpen ? '›' : '‹'}
          </button>
        </div>

        <aside
          className={cn(
            'rw-palette min-h-0 shrink-0 flex-col',
            paletteOpen && !asking ? 'flex' : 'hidden',
          )}
        >
          <RailwayPalette
            questionIds={view.questions.map((row) => row.questionId)}
            answers={view.answers}
            currentId={view.question?.questionId ?? null}
            counts={view.sectionCounts[view.sectionId] ?? view.counts}
            candidate={view.watermark}
            states={statesOf(view)}
            canOpen={view.canOpen}
            onOpen={view.openQuestion}
          />

          {/* Pinned, so it holds its place however far the grid above it scrolls. */}
          <div className="palettebottom flex justify-center">
            <button type="button" className="rw-submit" onClick={view.submit.ask}>
              Submit
            </button>
          </div>
        </aside>
      </div>

      {openPanel === 'PAPER' ? <PaperModal view={view} onClose={() => setOpenPanel(null)} /> : null}
      {openPanel === 'INSTRUCTIONS' ? (
        <InstructionsModal onClose={() => setOpenPanel(null)} />
      ) : null}
    </div>
  );
}

/** A forward-only paper reaches three of the five states, so it is taught and tallied in three. */
const statesOf = (view: ExamView) =>
  LEGEND_ORDER.filter((state) => !view.forwardOnly || !isReviewState(state));
const tallyOf = (view: ExamView) =>
  TALLY_ORDER.filter((state) => !view.forwardOnly || !isReviewState(state));

/** The question area: the stem and its options, or a word where a closed section was. */
function RailwayPaper({ view }: Readonly<{ view: ExamView }>) {
  if (!view.question) return <p className="questiondiv">This section is closed.</p>;

  return (
    <>
      {/* Siblings, as in the original: the stem's 26px leading must not reach the options. */}
      <div className="questiondiv">
        <RailwayQuestion
          question={view.question}
          languages={view.languages}
          languageMode={view.languageMode}
        />
      </div>
      <RailwayOptions
        question={view.question}
        languages={view.languages}
        languageMode={view.languageMode}
        selectedOptionId={view.selectedOptionId}
        onSelect={view.chooseOption}
      />
    </>
  );
}

/** One clock: a sectional paper counts the section it stands in, a composite one the paper. */
function RailwayTimer({ view }: Readonly<{ view: ExamView }>) {
  const sectionSec = view.sectional ? view.sectionSec : null;

  return sectionSec ? (
    <RailwaySectionClock key={view.sectionId} allowedSec={sectionSec} onExpire={view.endSection} />
  ) : (
    <RailwayPaperClock clock={view.clock} onExpire={view.outOfTime} />
  );
}

/** "Time Left : 89:58" — the original counts minutes past 59 rather than rolling into hours. */
function RailwayPaperClock({
  clock,
  onExpire,
}: Readonly<{ clock: ExamClock; onExpire: () => void }>) {
  const left = useCountdown(
    useCallback(() => secondsLeft(clock, Date.now()), [clock]),
    onExpire,
  );

  return (
    <p aria-live="off" className="right-time">
      Time Left : <b>{minuteClock(left)}</b>
    </p>
  );
}

/** A duration from the moment the section opened, not a server deadline the paper carries. */
function RailwaySectionClock({
  allowedSec,
  onExpire,
}: Readonly<{ allowedSec: number; onExpire: () => void }>) {
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const left = useCountdown(
    useCallback(() => {
      const since = openedAt.current === 0 ? Date.now() : openedAt.current;
      return Math.max(0, allowedSec - Math.round((Date.now() - since) / 1000));
    }, [allowedSec]),
    onExpire,
  );

  return (
    <p aria-live="off" className="right-time">
      Time Left : <b>{minuteClock(left)}</b>
    </p>
  );
}

function minuteClock(left: number): string {
  const safe = Math.max(0, left);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
