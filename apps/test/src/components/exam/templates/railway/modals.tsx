/** The two panels the utility bar opens. Both overlay the paper; neither stops the clock. */
import { contentLanguageOf } from '@iace/contracts';
import { htmlOf, shownLanguages, type ExamView } from '@iace/app-kit';
import { RichContent } from '@iace/ui';
import { ScrollPane } from './scroll-pane';

function Panel({
  title,
  onClose,
  children,
}: Readonly<{ title: string; onClose: () => void; children: React.ReactNode }>) {
  return (
    <div className="rw-panel absolute inset-x-8 bottom-16 top-16 flex flex-col border border-[#3272b9] bg-white shadow-lg">
      <div className="rw-modal-head flex items-center justify-between">
        <span>{title}</span>
        <button type="button" className="rw-modal-close" onClick={onClose}>
          Close X
        </button>
      </div>
      <ScrollPane className="min-h-0 flex-1 p-4">{children}</ScrollPane>
    </div>
  );
}

export function PaperModal({ view, onClose }: Readonly<{ view: ExamView; onClose: () => void }>) {
  const shown = shownLanguages(view.languages, view.languageMode);
  const language = shown[0];

  return (
    <Panel title="Question Paper" onClose={onClose}>
      <h2 className="mb-4 text-xl font-bold">{view.title}</h2>
      <ol className="flex flex-col">
        {view.questions.map((question, index) => (
          <li
            key={question.questionId}
            className="flex gap-4 border-b border-[#e0e0e0] py-3 text-sm"
          >
            <span className="w-10 shrink-0 text-[#666]">{`Q.${index + 1}`}</span>
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

export function InstructionsModal({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <Panel title="Instructions" onClose={onClose}>
      <h2 className="mb-4 text-center text-base font-bold text-[#3272b9]">Instructions</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p className="font-bold">General Instructions:</p>
        <p>
          1. The clock will be set at the server. The countdown timer at the top right corner of
          screen will display the remaining time available for you to complete the examination. When
          the timer reaches zero, the examination will end by itself. You will not be required to
          end or submit your examination.
        </p>
        <p>
          2. The Question Palette displayed on the right side of screen will show the status of each
          question.
        </p>
        <p>
          The <b>Marked for Review</b> status for a question simply indicates that you would like to
          look at that question again. If a question is answered, but marked for review, then the
          answer will be considered for evaluation unless the status is modified by the candidate.
        </p>
        <p className="font-bold underline">Navigating to a Question:</p>
        <p>
          Click on <b>Save &amp; Next</b> to save your answer for the current question and then go
          to the next question.
        </p>
        <p>
          Click on <b>Mark for Review &amp; Next</b> to save your answer for the current question,
          mark it for review, and then go to the next question.
        </p>
      </div>
    </Panel>
  );
}
