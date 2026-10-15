import { contentLanguageOf } from '@iace/contracts';
import { htmlOf, passagesOf, shownLanguages, type ExamView } from '@iace/app-kit';
import { RichContent } from '@iace/ui';
import { ScrollPane } from '../../scroll-pane';
import { Passage } from '../../passage';
import { RailwayQuestion } from '../railway/question';
import { isTypingQuestion, isWrittenQuestion } from '../../../typing/typing-figures';
import { ExamTyping, ExamWriting } from '../shared/exam-typing';

const OPTION_LETTERS = 'abcdefghij';

/** The framed question: its number on a bar, then the stem and the options, beside its passage when it has one. */
export function SscPaper({ view }: Readonly<{ view: ExamView }>) {
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
          {isWrittenQuestion(question) ? (
            <ExamWriting view={view} />
          ) : (
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
                      // A chosen radio fires no change, and here a second click clears it; a double-click's second is not one.
                      onClick={(event) => chosen && event.detail < 2 && view.clearResponse()}
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
          )}
        </ScrollPane>
      </div>
    </>
  );
}
