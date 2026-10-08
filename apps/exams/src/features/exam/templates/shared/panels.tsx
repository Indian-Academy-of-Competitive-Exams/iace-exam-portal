/** The two things a candidate may re-read mid-sitting: the whole paper, and the rules. */
import { contentLanguageOf, EXAM_TEMPLATE, TEST_UI } from '@iace/contracts';
import { htmlOf, shownLanguages, TIMER_KIND, type ExamView } from '@iace/app-kit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, RichContent } from '@iace/ui';
import { PaperRules } from '../../default-instructions';
import { PaletteLegend } from '../../question-palette';
import { PaperWatermark, type ExamSlotProps } from './slots';

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaperPanel({
  view,
  config,
  open,
  onOpenChange,
}: Readonly<ExamSlotProps & PanelProps>) {
  const language = shownLanguages(view.languages, view.languageMode)[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{view.title}</DialogTitle>
        </DialogHeader>

        <ol className="flex max-h-[60vh] flex-col overflow-y-auto">
          {view.questions.map((question, index) => (
            <li
              key={question.questionId}
              className="flex gap-4 border-b border-exam-border py-3 last:border-b-0"
            >
              <span className="w-10 shrink-0 text-sm text-exam-ink-muted">{`Q.${index + 1}`}</span>
              {language ? (
                <RichContent
                  lang={language.toLowerCase()}
                  className="text-sm leading-relaxed text-exam-ink"
                  html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
                />
              ) : null}
            </li>
          ))}
        </ol>

        {/* On the dialog, not in its list: a mark inside a scroller covers one screenful and scrolls away. */}
        <PaperWatermark view={view} config={config} />
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel({
  view,
  open,
  onOpenChange,
}: Readonly<{ view: ExamView } & PanelProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Instructions</DialogTitle>
        </DialogHeader>

        <div
          // Portalled out of the shell, so the legend names the skin itself or its swatches have no colour.
          data-exam-template={EXAM_TEMPLATE.DEFAULT.toLowerCase()}
          className="relative flex max-h-[60vh] flex-col gap-4 overflow-y-auto"
        >
          <PaperRules
            forwardOnly={view.forwardOnly}
            sectional={view.timer.kind === TIMER_KIND.SECTION}
            omr={view.testUi === TEST_UI.OMR}
          />
          <PaletteLegend forwardOnly={view.forwardOnly} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
