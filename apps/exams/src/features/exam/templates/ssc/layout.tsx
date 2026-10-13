/**
 * The SSC skin: the clock in the header, the section and four buttons above the question,
 * and a palette of small coloured chips on the right. Every value and callback comes off
 * the view, as in the other skins, so only the markup and the class names differ.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CirclePause } from 'lucide-react';
import { ANSWER_STATE, contentLanguageOf, isStateShown, type ExamClock } from '@iace/contracts';
import {
  htmlOf,
  passagesOf,
  PAUSE_SAYS,
  shownLanguages,
  TIMER_KIND,
  useAnchoredCountdown,
  useClockCountdown,
  type ExamView,
} from '@iace/app-kit';
import { useMediaQuery } from '@iace/app-kit/browser';
import { Alert, Button, RichContent, cn } from '@iace/ui';
import { ScrollPane } from '../../scroll-pane';
import { Passage } from '../../passage';
import { PaperWatermark, type ExamSlotProps } from '../shared/slots';
import { RailwayQuestion } from '../railway/question';
import profileImage from '../railway/assets/profile.png';
import { SscGuide, SscHeader, SscPhotoColumn } from './instructions';
import { ANALYTICS_ORDER, STATE_CLASS, STATE_LABEL, answeredOf, summaryOf } from './states';
import './ssc.css';
import { isTypingQuestion } from '../../../typing/typing-figures';
import { ExamTyping } from '../shared/exam-typing';

/** ssc.css lays the palette over the paper at the same width. */
const PHONE_QUERY = '(max-width: 767px)';
/** The original starts at its smallest and grows a tenth at a time to double. */
const FONT_STEP = { MIN: 0, MAX: 10 } as const;
const OPTION_LETTERS = 'abcdefghij';
const READING = { SYMBOLS: 'SYMBOLS', INSTRUCTIONS: 'INSTRUCTIONS' } as const;
type Reading = (typeof READING)[keyof typeof READING];

export function SscLayout({ view, config, onOpenCalculator, onPause }: Readonly<ExamSlotProps>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(!phone);
  const [reading, setReading] = useState<Reading | null>(null);
  const [fontStep, setFontStep] = useState(0);
  const [pausing, setPausing] = useState(false);
  // Held by id, so a clock that closes the section first takes the question about it away too.
  const [handingIn, setHandingIn] = useState<string | null>(null);
  const { submitSection, fullscreen } = view;
  const off = view.locked !== null;
  const sectional = view.timer.kind === TIMER_KIND.SECTION;
  const section = view.sections.find((row) => row.id === view.sectionId);
  const counts = view.sectionCounts(view.sectionId);
  const previous = view.questions[view.questionIndex - 1];
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
        tools={
          <div className="sc-tools flex flex-col items-center">
            <div className="flex">
              <button
                type="button"
                className="sc-zoom"
                disabled={fontStep >= FONT_STEP.MAX}
                onClick={() => setFontStep((step) => step + 1)}
              >
                Zoom (+)
              </button>
              <button
                type="button"
                className="sc-zoom"
                disabled={fontStep <= FONT_STEP.MIN}
                onClick={() => setFontStep((step) => step - 1)}
              >
                Zoom (−)
              </button>
            </div>
            {fullscreen.isSupported && !fullscreen.isFullscreen ? (
              <button type="button" className="sc-fullscreen" onClick={fullscreen.enter}>
                Enter Full Screen
              </button>
            ) : null}
          </div>
        }
      >
        <div className="sc-clock flex shrink-0">
          <div>
            <SscTimer view={view} />
            {onPause ? (
              <button
                type="button"
                className="sc-pause flex items-center"
                disabled={off}
                onClick={() => setPausing(true)}
              >
                <CirclePause aria-hidden />
                Pause Test
              </button>
            ) : null}
          </div>
          <img src={profileImage} alt="" />
        </div>
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
        <div className="flex min-h-0 flex-1">
          {leavingSection ? (
            <ExamSummary
              view={view}
              sectionIds={[view.sectionId]}
              confirmLabel="Next Section"
              onConfirm={() => {
                setHandingIn(null);
                submitSection();
              }}
              onCancel={() => setHandingIn(null)}
            />
          ) : (
            <ExamSummary
              view={view}
              sectionIds={sectional ? [view.sectionId] : view.sections.map((row) => row.id)}
              confirmLabel="Submit Test"
              pending={view.submit.isPending}
              onConfirm={view.submit.confirm}
              onCancel={view.submit.cancel}
            />
          )}
          <SscPhotoColumn />
        </div>
      ) : (
        <>
          <div className="sc-band shrink-0">
            <div className="flex items-start justify-between">
              <div className="sc-links flex flex-wrap">
                <button type="button" onClick={() => setReading(READING.SYMBOLS)}>
                  SYMBOLS
                </button>
                <button type="button" onClick={() => setReading(READING.INSTRUCTIONS)}>
                  INSTRUCTIONS
                </button>
                {onOpenCalculator ? (
                  <button type="button" onClick={onOpenCalculator}>
                    CALCULATOR
                  </button>
                ) : null}
              </div>
              <p className="sc-total">
                Total Questions answered : <b>{answeredOf(counts)}</b>
              </p>
            </div>

            {reading ? null : (
              <div className="sc-bar flex flex-wrap items-center justify-between">
                <div className="flex min-w-0 flex-wrap">
                  {view.sections
                    .filter((row) => view.reachable.includes(row.id))
                    .map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className={cn('sc-tab', row.id === view.sectionId && 'active')}
                        disabled={off}
                        onClick={() => view.openSection(row.id)}
                      >
                        {row.name}
                      </button>
                    ))}
                </div>
                <div className="sc-buttons flex flex-wrap">
                  {view.forwardOnly ? null : (
                    <>
                      <button
                        type="button"
                        className="sc-btn"
                        disabled={off || !previous || !view.canOpen(previous.questionId)}
                        onClick={() => previous && view.openQuestion(previous.questionId)}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className={cn('sc-btn', view.marked && 'sc-btn-unmark')}
                        disabled={off}
                        onClick={view.toggleMark}
                      >
                        {view.marked ? 'Unmark' : 'Mark for Review'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="sc-btn"
                    disabled={off}
                    onClick={view.nextQuestion}
                  >
                    Save &amp; Next
                  </button>
                  {submitSection ? (
                    <button
                      type="button"
                      className="sc-btn"
                      disabled={off}
                      onClick={() => setHandingIn(view.sectionId)}
                    >
                      Next Section
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sc-btn"
                      disabled={off}
                      onClick={view.submit.ask}
                    >
                      Submit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            className="relative flex min-h-0 flex-1"
            data-palette-open={paletteOpen || undefined}
          >
            <div className="sc-left flex min-w-0 flex-1 flex-col">
              {reading ? (
                <>
                  {/* Keyed, so asking for the symbols after the instructions scrolls to them again. */}
                  <div key={reading} className="sc-guide min-h-0 flex-1">
                    <SscGuide
                      sections={view.sections}
                      forwardOnly={view.forwardOnly}
                      sectional={sectional}
                      startAtSymbols={reading === READING.SYMBOLS}
                    />
                  </div>
                  <button type="button" className="sc-back" onClick={() => setReading(null)}>
                    Back
                  </button>
                </>
              ) : (
                <SscPaper view={view} />
              )}
            </div>

            <aside className="sc-side flex min-h-0 shrink-0 flex-col">
              <button
                type="button"
                aria-label={paletteOpen ? 'Collapse question palette' : 'Expand question palette'}
                className="sc-fold"
                onClick={() => setPaletteOpen((open) => !open)}
              />
              {paletteOpen ? (
                <>
                  <div className="sc-palette min-h-0">
                    <p>{section?.name} :</p>
                    <div className="sc-grid">
                      {view.questions.map((row, index) => {
                        const state =
                          view.answers[row.questionId]?.state ?? ANSWER_STATE.NOT_VISITED;
                        return (
                          <button
                            key={row.questionId}
                            type="button"
                            aria-current={row.questionId === view.question?.questionId}
                            disabled={!view.canOpen(row.questionId)}
                            aria-label={`Question ${index + 1}, ${STATE_LABEL[state]}`}
                            className={cn('sc-chip', STATE_CLASS[state])}
                            onClick={() => openQuestion(row.questionId)}
                          >
                            {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="sc-analytics shrink-0">
                    <p>Analytics</p>
                    <table>
                      <tbody>
                        {ANALYTICS_ORDER.filter((state) =>
                          isStateShown(state, view.forwardOnly),
                        ).map((state) => (
                          <tr key={state}>
                            <td>{STATE_LABEL[state]}</td>
                            <td>
                              <b>{counts[state]}</b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        </>
      )}

      {onPause && pausing ? (
        <SscBox label="Pause Test" says={PAUSE_SAYS.hint}>
          <button type="button" autoFocus onClick={onPause}>
            {PAUSE_SAYS.confirm}
          </button>
          <button type="button" onClick={() => setPausing(false)}>
            Carry on
          </button>
        </SscBox>
      ) : null}

      <PaperWatermark view={view} config={config} className="sc-watermark" />
    </div>
  );
}

/** The framed question: its number on a bar, then the stem and the options, beside its passage when it has one. */
function SscPaper({ view }: Readonly<{ view: ExamView }>) {
  const { question } = view;
  if (!question) return <p className="sc-qno">This section is closed.</p>;
  if (isTypingQuestion(question)) return <ExamTyping view={view} />;

  const passages = passagesOf(question.content, view.languages, view.languageMode);
  const shown = shownLanguages(view.languages, view.languageMode);
  const off = view.locked !== null;

  return (
    <>
      <div className="sc-qno shrink-0">{`Question No ${view.questionIndex + 1}`}</div>
      {/* Keyed, so the next question opens both panes at their top and not at the last one's offset. */}
      <div key={question.questionId} className="sc-qpane flex min-h-0 flex-1">
        {passages.length > 0 ? (
          <ScrollPane keys wheel className="sc-passage">
            <div className="sc-stem">
              <Passage passages={passages} />
            </div>
          </ScrollPane>
        ) : null}
        <ScrollPane keys wheel className="min-w-0 flex-1">
          <div className="sc-stem">
            <RailwayQuestion
              question={question}
              languages={view.languages}
              languageMode={view.languageMode}
            />
          </div>
          <div className="sc-options">
            {question.options.map((option, at) => {
              const chosen = option.id === view.selectedOptionId;
              return (
                <label key={option.id} className="sc-opt flex items-start">
                  <input
                    type="radio"
                    name={`q-${question.questionId}`}
                    checked={chosen}
                    disabled={off}
                    onChange={() => view.chooseOption(option.id)}
                    // A chosen radio fires no change, and on this screen a second click takes the answer off.
                    onClick={() => chosen && view.clearResponse()}
                  />
                  <span>{OPTION_LETTERS[at]})</span>
                  <span className="min-w-0">
                    {shown.map((language) => (
                      <RichContent
                        key={language}
                        lang={language.toLowerCase()}
                        html={htmlOf(option.text[contentLanguageOf(language)])}
                      />
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
        </ScrollPane>
      </div>
    </>
  );
}

/** What this screen asks with: a tally, the question under it and two plain buttons, then a word while it goes in. */
function ExamSummary({
  view,
  sectionIds,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: Readonly<{
  view: ExamView;
  sectionIds: readonly string[];
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="sc-summary min-w-0 flex-1">
      <h1>Exam Summary</h1>
      <table>
        <thead>
          <tr>
            <th>Section Name</th>
            <th>No of Questions</th>
            <th>Answered</th>
            <th>Not Answered</th>
            {view.forwardOnly ? null : <th>Marked for Review</th>}
            <th>Not Visited</th>
          </tr>
        </thead>
        <tbody>
          {view.sections
            .filter((section) => sectionIds.includes(section.id))
            .map((section) => {
              const row = summaryOf(view.sectionCounts(section.id));
              return (
                <tr key={section.id}>
                  <td>{section.name}</td>
                  <td>{section.questionCount}</td>
                  <td>{row.answered}</td>
                  <td>{row.notAnswered}</td>
                  {view.forwardOnly ? null : <td>{row.marked}</td>}
                  <td>{row.notVisited}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {pending ? (
        <p className="sc-wait">Please Wait ...</p>
      ) : (
        <>
          <p>Are you sure you want to submit?</p>
          <div className="flex items-center justify-center">
            <button type="button" onClick={onCancel}>
              Back
            </button>
            <button type="button" autoFocus onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The one box this screen says things in: a line of text over its buttons on a grey foot. */
function SscBox({
  label,
  says,
  children,
}: Readonly<{ label: string; says: string; children: ReactNode }>) {
  return (
    <div className="sc-overlay absolute inset-0 z-50 grid place-items-center p-4">
      <div role="dialog" aria-modal aria-label={label} className="sc-nag">
        <p>{says}</p>
        <div className="flex flex-wrap items-center justify-end">{children}</div>
      </div>
    </div>
  );
}

export function SscFullscreenNag({
  fullscreen,
  says,
}: Readonly<{ fullscreen: ExamView['fullscreen']; says: string }>) {
  return (
    <SscBox label="Full screen" says={says}>
      <button type="button" autoFocus onClick={fullscreen.enter}>
        Return to full screen
      </button>
      <button type="button" onClick={fullscreen.ignore}>
        Carry on without it
      </button>
    </SscBox>
  );
}

function SscTimer({ view: { timer } }: Readonly<{ view: ExamView }>) {
  return timer.kind === TIMER_KIND.SECTION ? (
    <SectionClock key={timer.key} allowedSec={timer.allowedSec} onExpire={timer.onExpire} />
  ) : (
    <PaperClock clock={timer.clock} onExpire={timer.onExpire} />
  );
}

function PaperClock({ clock, onExpire }: Readonly<{ clock: ExamClock; onExpire: () => void }>) {
  return <TimeLeft left={useClockCountdown(clock, onExpire)} />;
}

/** A duration from the moment the section opened, not a server deadline the paper carries. */
function SectionClock({
  allowedSec,
  onExpire,
}: Readonly<{ allowedSec: number; onExpire: () => void }>) {
  return <TimeLeft left={useAnchoredCountdown(allowedSec, onExpire)} />;
}

function TimeLeft({ left }: Readonly<{ left: number }>) {
  return (
    <p aria-live="off" className="sc-timer">
      Time Left: <b>{minuteClock(left)}</b>
    </p>
  );
}

/** "14:57", and "120:00" for a two-hour paper — this screen never shows an hours place. */
function minuteClock(left: number): string {
  const safe = Math.max(0, left);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(safe / 60))}:${two(safe % 60)}`;
}
