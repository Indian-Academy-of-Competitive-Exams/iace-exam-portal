/**
 * The slots both skins fill. They differ by TOKENS and by the config they are
 * handed — never by a fork, so neither can drift into behaving differently.
 * Nothing here holds state: every value and every callback comes off the view.
 */
import { Calculator, Eraser, FileText, Flag, Info, LayoutGrid, Maximize, Send } from 'lucide-react';
import {
  ANSWER_STATES,
  TEST_UI,
  type ExamTemplateConfig,
  type PaletteCounts,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Spinner,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Watermark,
  cn,
} from '@iace/ui';
import { ANSWER_STATE_LABELS, PAPER_LOCK, TIMER_KIND, type ExamView } from '@iace/app-kit';
import { ExamTimer } from '../../exam-timer';
import { OptionList } from '../../option-list';
import { QuestionPalette } from '../../question-palette';
import { QuestionStem } from '../../question-stem';
import { SectionTimer } from '../../section-timer';

/** Every slot is handed the same view, so a skin changes how the sitting LOOKS, never what it does. */
export interface ExamSlotProps {
  view: ExamView;
  config: ExamTemplateConfig;
  /** Absent where the config offers no calculator, which is how a skin knows not to draw it. */
  onOpenCalculator?: () => void;
}

const SWITCH: Readonly<Record<'TABS' | 'BUTTONS', string>> = {
  TABS: 'text-exam-section-ink data-[state=active]:border-exam-current data-[state=active]:text-exam-ink',
  BUTTONS: cn(
    'rounded-none border border-b border-exam-border bg-exam-surface-2 text-exam-section-ink',
    'data-[state=active]:border-exam-border data-[state=active]:bg-exam-section-active',
    'data-[state=active]:text-exam-section-active-ink',
  ),
};

/** Four worded controls and a clock do not fit a phone's header, so there each keeps only its glyph. */
const PHONE_ICON_ONLY = 'max-sm:sr-only';

export function Header({
  view,
  config,
  onOpenCalculator,
  onOpenPaper,
  onOpenRules,
}: Readonly<ExamSlotProps & { onOpenPaper?: () => void; onOpenRules?: () => void }>) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-exam-border px-exam py-3">
      <h1 className="min-w-0 truncate text-sm font-semibold text-exam-ink">{view.title}</h1>
      <div className="flex items-center gap-1 sm:gap-3">
        {view.hasUnsaved ? <Badge variant="warning">Not saved yet</Badge> : null}
        {view.isSaving ? <Spinner size="sm" label="Saving" /> : null}
        {view.locked === PAPER_LOCK.WAITING ? (
          <Spinner size="sm" label="Opening your paper" />
        ) : null}
        {onOpenPaper ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenPaper}>
            <FileText aria-hidden />
            <span className={PHONE_ICON_ONLY}>Question paper</span>
          </Button>
        ) : null}
        {onOpenRules ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenRules}>
            <Info aria-hidden />
            <span className={PHONE_ICON_ONLY}>Instructions</span>
          </Button>
        ) : null}
        {onOpenCalculator ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenCalculator}>
            <Calculator aria-hidden />
            <span className={PHONE_ICON_ONLY}>Calculator</span>
          </Button>
        ) : null}
        {/* The way IN: without it a candidate is only ever nagged for leaving a screen never offered. */}
        {view.fullscreen.isSupported && !view.fullscreen.isFullscreen ? (
          <Button type="button" variant="outline" size="sm" onClick={view.fullscreen.enter}>
            <Maximize aria-hidden />
            <span className={PHONE_ICON_ONLY}>Full screen</span>
          </Button>
        ) : null}
        {config.timerPosition === 'HEADER' ? <Timer view={view} config={config} /> : null}
      </div>
    </header>
  );
}

function Timer({ view: { timer }, config }: Readonly<ExamSlotProps>) {
  const labelled = config.timerFormat === 'LABELLED';
  return timer.kind === TIMER_KIND.SECTION ? (
    <SectionTimer
      key={timer.key}
      allowedSec={timer.allowedSec}
      onExpire={timer.onExpire}
      labelled={labelled}
    />
  ) : (
    <ExamTimer clock={timer.clock} onExpire={timer.onExpire} labelled={labelled} />
  );
}

/** What a section costs so far, without opening it — the one thing its tab cannot show. */
function sectionTally(counts: PaletteCounts): string {
  // The same five states the palette draws, so the tab and the grid never disagree.
  return ANSWER_STATES.filter((state) => counts[state] > 0)
    .map((state) => `${counts[state]} ${ANSWER_STATE_LABELS[state].toLowerCase()}`)
    .join(' · ');
}

export function SectionBar({
  view,
  config,
  onOpenPalette,
}: Readonly<ExamSlotProps & { onOpenPalette?: () => void }>) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-exam-border px-exam">
      <TabsList className="min-w-0 border-exam-border">
        {view.sections.map((section) => {
          const tally = sectionTally(view.sectionCounts(section.id));
          const trigger = (
            <TabsTrigger
              value={section.id}
              disabled={view.locked !== null || !view.reachable.includes(section.id)}
              className={SWITCH[config.sectionSwitch]}
            >
              {section.name}
            </TabsTrigger>
          );

          if (!tally) return <span key={section.id}>{trigger}</span>;

          return (
            <Tooltip key={section.id}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent>{tally}</TooltipContent>
            </Tooltip>
          );
        })}
      </TabsList>

      <div className="flex items-center gap-3">
        {config.timerPosition === 'SECTION_BAR' ? <Timer view={view} config={config} /> : null}
        {onOpenPalette ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenPalette}>
            <LayoutGrid aria-hidden />
            Palette
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function QuestionPanel({ view }: Readonly<ExamSlotProps>) {
  if (!view.question) return <Alert variant="info">This section is closed.</Alert>;

  return (
    <QuestionStem
      question={view.question}
      index={view.questionIndex}
      languages={view.languages}
      languageMode={view.languageMode}
    />
  );
}

export function Options({ view }: Readonly<ExamSlotProps>) {
  if (!view.question) return null;

  return (
    <OptionList
      question={view.question}
      languages={view.languages}
      languageMode={view.languageMode}
      selectedOptionId={view.selectedOptionId}
      marked={view.marked}
      testUi={view.testUi}
      disabled={view.locked !== null}
      onSelect={view.chooseOption}
      onBubble={view.bubbleAnswer}
    />
  );
}

export function Palette({
  view,
  onOpen = view.openQuestion,
}: Readonly<ExamSlotProps & { onOpen?: (questionId: string) => void }>) {
  return (
    <QuestionPalette
      questionIds={view.questions.map((row) => row.questionId)}
      answers={view.answers}
      currentId={view.question?.questionId ?? null}
      counts={view.sectionCounts(view.sectionId)}
      forwardOnly={view.forwardOnly}
      canOpen={view.canOpen}
      onOpen={onOpen}
    />
  );
}

export function BottomBar({ view }: Readonly<ExamSlotProps>) {
  // Drawn shut, not removed: the bar keeps its shape while the paper waits, goes in or is out of time.
  const off = view.locked !== null;

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-exam-border px-exam py-3">
      {view.submit.failed ? (
        <Alert variant="danger" className="flex w-full items-center justify-between gap-2">
          Could not submit this paper.
          <Button type="button" variant="outline" size="sm" onClick={view.submit.retry}>
            Try again
          </Button>
        </Alert>
      ) : null}
      {/* On a bubble sheet the ink carries all three: a part fill flags it, a full one saves and moves. */}
      {view.testUi === TEST_UI.OMR ? (
        <Button type="button" size="sm" disabled={off} onClick={view.nextQuestion}>
          Next
        </Button>
      ) : (
        <>
          {view.forwardOnly ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={off}
              onClick={view.markAndNext}
            >
              <Flag aria-hidden />
              Mark for review &amp; next
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={off}
            onClick={view.clearResponse}
          >
            <Eraser aria-hidden />
            Clear response
          </Button>
          <Button type="button" size="sm" disabled={off} onClick={view.nextQuestion}>
            Save &amp; next
          </Button>
        </>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        loading={view.submit.isPending}
        disabled={off}
        onClick={view.submit.ask}
      >
        <Send aria-hidden />
        Submit
      </Button>
    </footer>
  );
}

export function PaperWatermark({
  view,
  config,
  className,
}: Readonly<ExamSlotProps & { className?: string }>) {
  if (config.watermark === 'NONE' || !view.watermark) return null;

  return <Watermark text={view.watermark} className={className} />;
}
