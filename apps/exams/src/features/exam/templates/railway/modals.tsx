/** The two panels the utility bar opens. Both overlay the paper; neither stops the clock. */
import { contentLanguageOf } from '@iace/contracts';
import { htmlOf, shownLanguages, type ExamView } from '@iace/app-kit';
import { RichContent } from '@iace/ui';
import { isSectional } from '../../use-instructions';
import { GeneralScreen } from './instructions';
import { ScrollPane } from './scroll-pane';

function Panel({
  title,
  onClose,
  children,
}: Readonly<{ title: string; onClose: () => void; children: React.ReactNode }>) {
  return (
    <div className="rw-panel absolute inset-x-2 bottom-16 top-16 flex flex-col shadow-lg sm:inset-x-8">
      <div className="rw-modal-head flex items-center justify-between">
        <span>{title}</span>
        <button type="button" className="rw-modal-close" onClick={onClose}>
          Close X
        </button>
      </div>
      <ScrollPane className="flex min-h-0 flex-1 flex-col gap-4 p-4">{children}</ScrollPane>
    </div>
  );
}

export function PaperModal({ view, onClose }: Readonly<{ view: ExamView; onClose: () => void }>) {
  const shown = shownLanguages(view.languages, view.languageMode);
  const language = shown[0];

  return (
    <Panel title="Question Paper" onClose={onClose}>
      <h2 className="text-xl font-bold">{view.title}</h2>
      <ol className="flex flex-col">
        {view.questions.map((question, index) => (
          <li key={question.questionId} className="rw-paper-row flex gap-4 py-3 text-sm">
            <span className="rw-paper-no w-10 shrink-0">{`Q.${index + 1}`}</span>
            {language ? (
              <RichContent
                lang={language.toLowerCase()}
                html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function InstructionsModal({
  view,
  onClose,
}: Readonly<{ view: ExamView; onClose: () => void }>) {
  return (
    <Panel title="Instructions" onClose={onClose}>
      <h2 className="rw-rules-title text-center text-base font-bold">Instructions</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <GeneralScreen forwardOnly={view.forwardOnly} sectional={isSectional(view.sections)} />
      </div>
    </Panel>
  );
}
