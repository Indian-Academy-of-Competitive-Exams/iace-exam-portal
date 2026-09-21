/**
 * The SSC/Railway skin. It fills the same slots as the default one and takes every
 * value and callback off the view — only the markup and the class names differ, so
 * the two skins cannot drift into behaving differently.
 */
import { useCallback, useState } from 'react';
import { secondsLeft, type ExamClock } from '@iace/contracts';
import { useCountdown } from '@iace/app-kit';
import { cn } from '@iace/ui';
import { RailwayOptions, RailwayQuestion } from './question';
import { type ExamSlotProps } from '../shared/slots';
import { RailwayPalette } from './palette';
import { InfoTally } from './info-popup';
import { PaperModal, InstructionsModal } from './modals';
import './railway.css';

export function RailwayLayout({ view }: Readonly<ExamSlotProps>) {
  const [openPanel, setOpenPanel] = useState<'PAPER' | 'INSTRUCTIONS' | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);

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
              <InfoTally counts={view.counts} label="Status for this test" />
            </span>
          </div>

          <div className="time-left-sect flex shrink-0 items-center justify-between">
            <span>Section</span>
            <RailwayTimer clock={view.clock} onExpire={view.outOfTime} />
          </div>

          <div className="flex shrink-0 items-center gap-1 px-3 py-1">
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
                <InfoTally counts={view.counts} label={`Status for ${section.name}`} />
              </span>
            ))}
          </div>

          <div className="new-tab-second flex shrink-0 items-center justify-between">
            <span className="rw-qtype">Question Type : Multiple Choice Question</span>
            <span className="rw-marks">
              Marks For Correct Answer: <em>1</em> | Negative Mark: <em>0.33</em>
            </span>
          </div>

          <div className="questn flex shrink-0 items-center justify-between">
            <span>{`Question No. ${view.questionIndex + 1}`}</span>
            <button type="button" className="btn" onClick={view.fullscreen.enter}>
              View Full Screen
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {view.question ? (
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
            ) : (
              <p className="questiondiv">This section is closed.</p>
            )}
          </div>

          <div className="rw-buttons flex items-center gap-2">
            <button type="button" className="btn" onClick={view.markAndNext}>
              Mark for Review &amp; Next
            </button>
            <button type="button" className="btn" onClick={view.clearResponse}>
              Clear Response
            </button>
            <button type="button" className="savenext ml-auto" onClick={view.nextQuestion}>
              Save &amp; Next
            </button>
          </div>
        </div>

        <div className="relative w-0 shrink-0">
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
          className={cn('rw-palette min-h-0 shrink-0 flex-col', paletteOpen ? 'flex' : 'hidden')}
        >
          <RailwayPalette
            questionIds={view.questions.map((row) => row.questionId)}
            answers={view.answers}
            currentId={view.question?.questionId ?? null}
            counts={view.counts}
            candidate={view.watermark}
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

/** "Time Left : 89:58" — the original counts minutes past 59 rather than rolling into hours. */
function RailwayTimer({ clock, onExpire }: Readonly<{ clock: ExamClock; onExpire: () => void }>) {
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

function minuteClock(left: number): string {
  const safe = Math.max(0, left);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
