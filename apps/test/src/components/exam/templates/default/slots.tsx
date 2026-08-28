/**
 * Template instance #1 — the screen the engine plan shipped, now behind the
 * contract with its markup intact. Nothing here holds state: every value and
 * every callback comes off the view.
 */
import { Flag, Eraser, Send } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Watermark,
  cn,
} from '@iace/ui';
import { ExamTimer } from '../../exam-timer';
import { OptionList } from '../../option-list';
import { QuestionPalette } from '../../question-palette';
import { QuestionStem } from '../../question-stem';
import { SectionTimer } from '../../section-timer';
import type { ExamLayoutProps, ExamSlotProps } from '../../engine/template';

export function Header({ view }: Readonly<ExamSlotProps>) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">{view.title}</h1>
      <div className="flex items-center gap-3">
        {view.hasUnsaved ? <Badge variant="warning">Not saved yet</Badge> : null}
        {view.isSaving ? <Spinner size="sm" label="Saving" /> : null}
        <Timer view={view} />
      </div>
    </header>
  );
}

export function Timer({ view }: Readonly<ExamSlotProps>) {
  return <ExamTimer clock={view.clock} onExpire={view.outOfTime} />;
}

export function SectionBar({ view }: Readonly<ExamSlotProps>) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <TabsList>
        {view.sections.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            disabled={!view.reachable.includes(section.id)}
          >
            {section.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {view.sectionSec ? (
        <SectionTimer
          key={view.sectionId}
          allowedSec={view.sectionSec}
          onExpire={view.endSection}
        />
      ) : null}
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
      onSelect={view.chooseOption}
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
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
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

      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('ml-auto')}
        loading={view.submit.isPending}
        onClick={view.submit.ask}
      >
        <Send aria-hidden />
        Submit
      </Button>
    </footer>
  );
}

export function PaperWatermark({ view }: Readonly<ExamSlotProps>) {
  return view.watermark ? <Watermark text={view.watermark} /> : null;
}

export function Layout({ view, slots }: Readonly<ExamLayoutProps>) {
  return (
    <>
      <slots.Header view={view} />

      <Tabs value={view.sectionId} onValueChange={view.openSection} className="min-h-0 flex-1">
        <slots.SectionBar view={view} />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
            <slots.Watermark view={view} />
            <article className="flex min-w-0 flex-col gap-4">
              <slots.QuestionPanel view={view} />
              <slots.OptionList view={view} />
            </article>
          </div>

          <aside className="shrink-0 border-t border-border p-4 lg:w-72 lg:border-l lg:border-t-0">
            <slots.Palette view={view} />
          </aside>
        </div>
      </Tabs>

      <slots.BottomBar view={view} />
    </>
  );
}
