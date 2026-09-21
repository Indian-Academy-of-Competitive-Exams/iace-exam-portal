/** The two things a candidate may re-read mid-sitting: the whole paper, and the rules. */
import { contentLanguageOf } from '@iace/contracts';
import { htmlOf, shownLanguages, type ExamView } from '@iace/app-kit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, RichContent } from '@iace/ui';
import { PALETTE_LEGEND } from '../../../../lib/constants';

export function PaperPanel({
  view,
  open,
  onOpenChange,
}: Readonly<{ view: ExamView; open: boolean; onOpenChange: (open: boolean) => void }>) {
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
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Instructions</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm leading-relaxed text-exam-ink">
          <p>
            The clock is the server&apos;s. It keeps running if you leave this screen, and the paper
            ends by itself when it reaches zero — you do not have to submit for that to happen.
          </p>
          <p>The palette marks every question with one of these:</p>
          <ul className="flex flex-col gap-1.5">
            {PALETTE_LEGEND.map((entry) => (
              <li key={entry.state} className="text-exam-ink-muted">
                <span className="font-medium text-exam-ink">{entry.label}</span>
              </li>
            ))}
          </ul>
          <p>
            <span className="font-medium">Save &amp; next</span> keeps your answer and moves on.{' '}
            <span className="font-medium">Mark for review &amp; next</span> keeps it and flags the
            question to come back to — a flagged answer is still marked.{' '}
            <span className="font-medium">Clear response</span> removes your answer entirely.
          </p>
          <p>
            Moving to another question from the palette does not save the one you are on. Save it
            first if you want it kept.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
