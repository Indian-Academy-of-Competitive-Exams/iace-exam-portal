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
import { PaperModal, InstructionsModal } from './modals';
import './railway.css';

export function RailwayLayout({ view }: Readonly<ExamSlotProps>) {
  const [openPanel, setOpenPanel] = useState<'PAPER' | 'INSTRUCTIONS' | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rw-header flex items-center justify-center">
        <div className="logo-header">
          <span className="rw-logo">IACE</span>
        </div>
      </div>

      <div className="rw-utilitybar flex items-center justify-end gap-6 px-4">
        <button type="button" onClick={() => setOpenPanel('PAPER')}>
          Question paper
        </button>
        <button type="button" onClick={() => setOpenPanel('INSTRUCTIONS')}>
          Instruction
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="bg-[#f5f5f5] px-3 py-2.5">
            <span className="rw-testname">{view.title}</span>
          </div>

          <div className="rw-sectionbar flex items-center justify-between py-1.5">
            <span>Section</span>
            <RailwayTimer clock={view.clock} onExpire={view.outOfTime} />
          </div>

          <div className="flex items-center gap-1 border-b border-[#d8d8d8] px-2 py-1">
            {view.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className="rw-sectiontab"
                data-state={section.id === view.sectionId ? 'active' : 'inactive'}
                disabled={!view.reachable.includes(section.id)}
                onClick={() => view.openSection(section.id)}
              >
                {section.name}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-b border-[#d8d8d8] px-3 py-1.5">
            <span className="rw-qtype">Question Type : Multiple Choice Question</span>
            <span className="rw-marks">
              Marks For Correct Answer: <em>1</em> | Negative Mark: <em>0.33</em>
            </span>
          </div>

          <div className="rw-qno flex items-center justify-between">
            <span>{`Question No. ${view.questionIndex + 1}`}</span>
            <button type="button" className="btn !my-0" onClick={view.fullscreen.enter}>
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

          <div className="rw-buttons flex shrink-0 items-center gap-2">
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

        <aside className={cn('rw-palette shrink-0', paletteOpen ? 'block' : 'hidden')}>
          <RailwayPalette
            questionIds={view.questions.map((row) => row.questionId)}
            answers={view.answers}
            currentId={view.question?.questionId ?? null}
            counts={view.counts}
            candidate={view.watermark}
            onOpen={view.openQuestion}
            onSubmit={view.submit.ask}
          />
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
    <p aria-live="off" className="rw-timeleft">
      Time Left : <b>{minuteClock(left)}</b>
    </p>
  );
}

function minuteClock(left: number): string {
  const safe = Math.max(0, left);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
