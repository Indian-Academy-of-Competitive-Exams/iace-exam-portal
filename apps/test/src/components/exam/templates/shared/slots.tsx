/**
 * The slots both skins fill. They differ by TOKENS and by the config they are
 * handed — never by a fork, so neither can drift into behaving differently.
 * Nothing here holds state: every value and every callback comes off the view.
 */
import { Flag, Eraser, Send } from 'lucide-react';
import { TEST_UI } from '@iace/contracts';
import { Alert, Badge, Button, Spinner, TabsList, TabsTrigger, Watermark, cn } from '@iace/ui';
import { ExamTimer } from '../../exam-timer';
import { OptionList } from '../../option-list';
import { QuestionPalette } from '../../question-palette';
import { QuestionStem } from '../../question-stem';
import { SectionTimer } from '../../section-timer';
import type { ExamSlotProps } from '../../engine/template';

const SWITCH: Readonly<Record<'TABS' | 'BUTTONS', string>> = {
  TABS: 'text-exam-section-ink data-[state=active]:border-exam-current data-[state=active]:text-exam-ink',
  BUTTONS: cn(
    'rounded-none border border-b border-exam-border bg-exam-surface-2 text-exam-section-ink',
    'data-[state=active]:border-exam-border data-[state=active]:bg-exam-section-active',
    'data-[state=active]:text-exam-section-active-ink',
  ),
};

export function Header({ view, config }: Readonly<ExamSlotProps>) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-exam-border px-exam py-3">
      <h1 className="min-w-0 truncate text-sm font-semibold text-exam-ink">{view.title}</h1>
      <div className="flex items-center gap-3">
        {view.hasUnsaved ? <Badge variant="warning">Not saved yet</Badge> : null}
        {view.isSaving ? <Spinner size="sm" label="Saving" /> : null}
        {config.timerPosition === 'HEADER' ? <Timer view={view} config={config} /> : null}
      </div>
    </header>
  );
}

export function Timer({ view, config }: Readonly<ExamSlotProps>) {
  return (
    <ExamTimer
      clock={view.clock}
      onExpire={view.outOfTime}
      labelled={config.timerFormat === 'LABELLED'}
    />
  );
}

export function SectionBar({ view, config }: Readonly<ExamSlotProps>) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-exam-border px-exam">
      <TabsList className="border-exam-border">
        {view.sections.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            disabled={!view.reachable.includes(section.id)}
            className={SWITCH[config.sectionSwitch]}
          >
            {section.name}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="flex items-center gap-3">
        {view.sectionSec ? (
          <SectionTimer
            key={view.sectionId}
            allowedSec={view.sectionSec}
            onExpire={view.endSection}
          />
        ) : null}
        {config.timerPosition === 'SECTION_BAR' ? <Timer view={view} config={config} /> : null}
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
      onSelect={view.chooseOption}
      onBubble={view.bubbleAnswer}
    />
  );
}

export function Palette({ view }: Readonly<ExamSlotProps>) {
  return (
    <QuestionPalette
      questionIds={view.questions.map((row) => row.questionId)}
      answers={view.answers}
      currentId={view.question?.questionId ?? null}
      counts={view.counts}
      onOpen={view.openQuestion}
    />
  );
}

export function BottomBar({ view }: Readonly<ExamSlotProps>) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-exam-border px-exam py-3">
      {/* On a bubble sheet the ink carries all three: a part fill flags it, a full one saves and moves. */}
      {view.testUi === TEST_UI.OMR ? (
        <Button type="button" size="sm" onClick={view.nextQuestion}>
          Next
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" onClick={view.markAndNext}>
            <Flag aria-hidden />
            Mark for review &amp; next
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={view.clearResponse}>
            <Eraser aria-hidden />
            Clear response
          </Button>
          <Button type="button" size="sm" onClick={view.nextQuestion}>
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
        onClick={view.submit.ask}
      >
        <Send aria-hidden />
        Submit
      </Button>
    </footer>
  );
}

export function PaperWatermark({ view, config }: Readonly<ExamSlotProps>) {
  if (config.watermark === 'NONE' || !view.watermark) return null;

  return <Watermark text={view.watermark} />;
}
