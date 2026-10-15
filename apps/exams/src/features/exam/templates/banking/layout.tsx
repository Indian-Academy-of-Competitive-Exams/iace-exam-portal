/**
 * The Banking skin: the IBPS-style screen, with section tabs across the top, the clock
 * beside them and the palette on the right. Every value and callback comes off the view,
 * as in the other skins, so only the markup and the class names differ.
 */
import { useState, type CSSProperties } from 'react';
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Info,
  Maximize2,
  Minus,
  Plus,
  Type,
} from 'lucide-react';
import { ANSWER_STATE, isStateShown } from '@iace/contracts';
import { passagesOf, TIMER_KIND, usePause, type ExamView } from '@iace/app-kit';
import { useMediaQuery } from '@iace/app-kit/browser';
import { Alert, Brandmark, Button, cn } from '@iace/ui';
import { ScrollPane } from '../../scroll-pane';
import { PaperWatermark, type ExamSlotProps } from '../shared/slots';
import { Countdown } from '../shared/countdown';
import { PHONE_QUERY } from '../shared/phone-query';
import { Passage } from '../../passage';
import { RailwayOptions, RailwayQuestion } from '../railway/question';
import profileImage from '../railway/assets/profile.png';
import { BankingInstructionsDialog, BankingPauseDialog } from './info-dialog';
import { BankingGeneral } from './instructions';
import { LEGEND_ORDER, STATE_CLASS, STATE_LABEL, StateBadge } from './states';
import { BankingSummaryDialog } from './submit-dialog';
import './banking.css';
import {
  answersByKeyboard,
  isTypingQuestion,
  isWrittenQuestion,
} from '../../../typing/typing-figures';
import { ExamTyping, ExamWriting } from '../shared/exam-typing';
import { TimeWarning } from '../../time-warning';

const FONT_STEP = { MIN: -2, MAX: 4 } as const;

export function BankingLayout({
  view,
  config,
  onOpenCalculator,
  onPause,
}: Readonly<ExamSlotProps>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(!phone);
  const [reading, setReading] = useState(false);
  const [fontStep, setFontStep] = useState(0);
  const pause = usePause(onPause);
  // Held by id, so a clock that closes the section first takes the question about it away too.
  const [handingIn, setHandingIn] = useState<string | null>(null);
  const { submitSection } = view;
  const off = view.locked !== null;
  const section = view.sections.find((row) => row.id === view.sectionId);
  const states = LEGEND_ORDER.filter((state) => isStateShown(state, view.forwardOnly));
  // Over the paper the palette hides the question it just opened, so opening one puts it away.
  const openQuestion = (questionId: string) => {
    view.openQuestion(questionId);
    if (phone) setPaletteOpen(false);
  };

  return (
    <div
      className="bk-screen relative flex min-h-0 flex-1 flex-col"
      style={{ '--bk-font-step': fontStep } as CSSProperties}
    >
      <div className="bk-titlebar flex shrink-0 items-center justify-between">
        <Brandmark />
        <strong className="bk-testname">{view.title}</strong>
        <div className="flex items-center">
          {view.fullscreen.isSupported ? (
            <button
              type="button"
              aria-label="Full screen"
              className="bk-tool bk-tool-boxed"
              onClick={view.fullscreen.enter}
            >
              <Maximize2 aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Smaller text"
            className="bk-tool"
            disabled={fontStep <= FONT_STEP.MIN}
            onClick={() => setFontStep((step) => step - 1)}
          >
            <Minus aria-hidden />
          </button>
          <Type className="bk-tool-glyph" aria-hidden />
          <button
            type="button"
            aria-label="Larger text"
            className="bk-tool"
            disabled={fontStep >= FONT_STEP.MAX}
            onClick={() => setFontStep((step) => step + 1)}
          >
            <Plus aria-hidden />
          </button>
          {onPause ? (
            <button type="button" className="bk-pause" disabled={off} onClick={pause.ask}>
              Pause Test
            </button>
          ) : null}
        </div>
      </div>

      <div className="bk-lower flex shrink-0">
        <div className="bk-category min-w-0 flex-1">
          <div className="bk-tabrow flex">
            <div className="flex min-w-0 flex-1">
              {view.sections.map((row) => (
                <SectionTab key={row.id} view={view} sectionId={row.id} name={row.name} off={off} />
              ))}
            </div>
            <BankingTimer view={view} />
          </div>
          <div className="bk-subject flex items-center justify-between">
            <span>{section?.name}</span>
          </div>
        </div>

        <div className="bk-profile flex shrink-0 flex-col">
          <div className="bk-profile-strip flex items-center justify-center gap-4">
            <button type="button" className="flex items-center" onClick={() => setReading(true)}>
              <span className="bk-info-dot" aria-hidden>
                <Info />
              </span>
              <span>Instructions</span>
            </button>
            {onOpenCalculator ? (
              <button type="button" className="flex items-center" onClick={onOpenCalculator}>
                <Calculator aria-hidden />
                <span>Calculator</span>
              </button>
            ) : null}
          </div>
          <div className="bk-photos flex flex-1 items-center justify-center">
            <img src={profileImage} alt="" />
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1" data-palette-open={paletteOpen || undefined}>
        <div className="bk-paper relative min-w-0 flex-1">
          <BankingPaper view={view} />
          <button
            type="button"
            aria-label={paletteOpen ? 'Collapse question palette' : 'Expand question palette'}
            className="bk-drawer-toggle"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            {paletteOpen ? <ChevronRight aria-hidden /> : <ChevronLeft aria-hidden />}
          </button>
        </div>

        <aside
          className={cn('bk-drawer min-h-0 shrink-0 flex-col', paletteOpen ? 'flex' : 'hidden')}
        >
          {view.watermark ? <div className="bk-roll shrink-0">{view.watermark}</div> : null}

          <div className="bk-legend shrink-0">
            {states.map((state) => (
              <div
                key={state}
                className="flex items-center"
                data-wide={state === ANSWER_STATE.ANSWERED_MARKED || undefined}
              >
                <StateBadge state={state} count={view.sectionCounts(view.sectionId)[state]} />
                <span>{STATE_LABEL[state]}</span>
              </div>
            ))}
          </div>

          <div className="bk-panel flex min-h-0 flex-1 flex-col">
            <div className="bk-panel-title shrink-0">{section?.name}</div>
            <div className="bk-grid-scroll min-h-0 flex-1">
              <div className="bk-grid">
                {view.questions.map((row, index) => {
                  const state = view.answers[row.questionId]?.state ?? ANSWER_STATE.NOT_VISITED;
                  return (
                    <button
                      key={row.questionId}
                      type="button"
                      aria-current={row.questionId === view.question?.questionId}
                      disabled={!view.canOpen(row.questionId)}
                      aria-label={`Question ${index + 1}, ${STATE_LABEL[state]}`}
                      className={cn('bk-cell', STATE_CLASS[state])}
                      onClick={() => openQuestion(row.questionId)}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {view.submit.failed ? (
        <Alert variant="danger" className="flex shrink-0 items-center justify-between gap-2">
          Could not submit this paper.
          <Button type="button" variant="outline" size="sm" onClick={view.submit.retry}>
            Try again
          </Button>
        </Alert>
      ) : null}

      <div className="bk-footer flex shrink-0">
        <div className="bk-footer-main flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            {view.forwardOnly ? null : (
              <button type="button" className="bk-btn" disabled={off} onClick={view.markAndNext}>
                Mark for Review &amp; Next
              </button>
            )}
            <button
              type="button"
              className="bk-btn bk-btn-outline"
              disabled={off || answersByKeyboard(view.question)}
              onClick={view.clearResponse}
            >
              Clear Response
            </button>
          </div>
          <button type="button" className="bk-btn" disabled={off} onClick={view.nextQuestion}>
            Save &amp; Next
          </button>
        </div>
        <div className="bk-footer-side flex shrink-0 items-center justify-center">
          {submitSection ? (
            <button
              type="button"
              className="bk-btn"
              disabled={off}
              onClick={() => setHandingIn(view.sectionId)}
            >
              SUBMIT SECTION
            </button>
          ) : (
            <button type="button" className="bk-btn" disabled={off} onClick={view.submit.ask}>
              SUBMIT
            </button>
          )}
        </div>
      </div>

      {reading ? (
        <BankingInstructionsDialog onClose={() => setReading(false)}>
          <BankingGeneral
            forwardOnly={view.forwardOnly}
            sectional={view.timer.kind === TIMER_KIND.SECTION}
          />
        </BankingInstructionsDialog>
      ) : null}

      {submitSection && section && handingIn === view.sectionId ? (
        <BankingSummaryDialog
          asks="Do you want to Submit this Section?"
          confirmLabel="Submit Section"
          sections={[section]}
          countsOf={view.sectionCounts}
          onConfirm={() => {
            setHandingIn(null);
            submitSection();
          }}
          onCancel={() => setHandingIn(null)}
        />
      ) : null}

      {view.submit.asking || view.submit.isPending ? (
        <BankingSummaryDialog
          asks="Do you want to Submit the Test?"
          confirmLabel="Submit"
          sections={view.sections}
          countsOf={view.sectionCounts}
          pending={view.submit.isPending}
          onConfirm={view.submit.confirm}
          onCancel={view.submit.cancel}
        />
      ) : null}

      {pause.asking ? <BankingPauseDialog pause={pause} /> : null}

      <PaperWatermark view={view} config={config} className="bk-watermark" />
    </div>
  );
}

/** A section's tab, with the tally its blue (i) drops open on hover or focus. */
function SectionTab({
  view,
  sectionId,
  name,
  off,
}: Readonly<{ view: ExamView; sectionId: string; name: string; off: boolean }>) {
  const counts = view.sectionCounts(sectionId);

  return (
    <div className={cn('bk-tab flex items-center', sectionId === view.sectionId && 'active')}>
      <button
        type="button"
        className="bk-tab-name"
        disabled={off || !view.reachable.includes(sectionId)}
        onClick={() => view.openSection(sectionId)}
      >
        {name}
      </button>
      <button type="button" className="bk-info-dot" aria-label={`Status for ${name}`}>
        <Info aria-hidden />
      </button>
      <div className="bk-tally">
        <div className="bk-tally-title">{name}</div>
        {LEGEND_ORDER.filter((state) => isStateShown(state, view.forwardOnly)).map((state) => (
          <div key={state} className="bk-tally-row flex items-center">
            <StateBadge state={state} count={counts[state]} />
            <span>{STATE_LABEL[state]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The question column: its number, the stem and the options, or a word where a closed section was. */
function BankingPaper({ view }: Readonly<{ view: ExamView }>) {
  if (!view.question) return <p className="bk-question-no">This section is closed.</p>;
  if (isTypingQuestion(view.question)) return <ExamTyping view={view} />;

  const passages = passagesOf(view.question.content, view.languages, view.languageMode);

  return (
    // Keyed, so the next question opens both panes at their top and not at the last one's offset.
    <div key={view.question.questionId} className="bk-split">
      {passages.length > 0 ? (
        <ScrollPane keys className="bk-passage">
          <div className="bk-passage-text">
            <Passage passages={passages} />
          </div>
        </ScrollPane>
      ) : null}
      <ScrollPane keys className="bk-question-scroll">
        <div className="bk-question-col">
          <div className="bk-question-no">{`Question No. ${view.questionIndex + 1} :`}</div>
          <div className="bk-question">
            <RailwayQuestion
              question={view.question}
              languages={view.languages}
              languageMode={view.languageMode}
            />
          </div>
          {isWrittenQuestion(view.question) ? (
            <ExamWriting view={view} />
          ) : (
            <RailwayOptions
              question={view.question}
              languages={view.languages}
              languageMode={view.languageMode}
              selectedOptionId={view.selectedOptionId}
              disabled={view.locked !== null}
              onSelect={view.chooseOption}
            />
          )}
        </div>
      </ScrollPane>
    </div>
  );
}

function BankingTimer({ view }: Readonly<{ view: ExamView }>) {
  return <Countdown view={view}>{(left) => <TimeLeft left={left} />}</Countdown>;
}

function TimeLeft({ left }: Readonly<{ left: number }>) {
  return (
    <p role="timer" aria-live="off" className="bk-timer flex shrink-0 items-center">
      <span>Time Left :</span>
      <b>{hourClock(left)}</b>
      <TimeWarning left={left} />
    </p>
  );
}

/** "00:19:27" — this screen always shows the hours, even when there are none. */
function hourClock(left: number): string {
  const safe = Math.max(0, left);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(safe / 3600))}:${two(Math.floor((safe % 3600) / 60))}:${two(safe % 60)}`;
}
