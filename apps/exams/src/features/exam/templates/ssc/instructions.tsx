/**
 * The SSC pre-test screen: one page, the paper's figures over the symbols and the rules,
 * with the language and the start button under it. The same guide is read again from
 * inside the sitting, so the two cannot describe different papers.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { contentLanguageOf, LANGUAGE_LABELS, type LanguageCode } from '@iace/contracts';
import { Brandmark } from '@iace/ui';
import { type InstructionsView } from '../../use-instructions';
import profileImage from '../railway/assets/profile.png';
import './ssc.css';

export interface GuideSection {
  id: string;
  name: string;
  questionCount: number;
  maxScore?: number;
  durationSec: number | null;
}

export function SscInstructions({ view }: Readonly<{ view: InstructionsView }>) {
  const { brief } = view;

  return (
    <div data-exam-template="ssc" className="sc-screen flex h-dvh flex-col">
      <SscHeader title={brief.title} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sc-guide min-h-0 flex-1">
            <SscGuide
              sections={brief.sections.map((section) => ({
                ...section,
                maxScore: section.questionCount * section.marksPerQuestion,
              }))}
              minutes={Math.round(brief.durationSec / 60)}
              forwardOnly={view.forwardOnly}
              sectional={view.sectional}
            />
          </div>

          <label className="flex shrink-0 items-start justify-center gap-2 px-4 pb-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={view.declared}
              onChange={(event) => view.declare(event.target.checked)}
            />
            <span>I have read and understood the instructions.</span>
          </label>

          <div className="sc-start flex shrink-0 flex-wrap items-center justify-center">
            {view.dual ? null : (
              <label className="flex items-center">
                <span>Choose Language:</span>
                <select
                  value={view.language}
                  onChange={(event) => view.chooseLanguage(event.target.value as LanguageCode)}
                >
                  <option value="">--Select--</option>
                  {brief.languages.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_LABELS[contentLanguageOf(code)]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" disabled={!view.ready} onClick={view.begin}>
              Start Test
            </button>
          </div>
        </div>

        <SscPhotoColumn />
      </div>
    </div>
  );
}

/** The bar every SSC screen opens with; the sitting adds its tools and its clock. */
export function SscHeader({
  title,
  tools,
  children,
}: Readonly<{ title: string | null; tools?: ReactNode; children?: ReactNode }>) {
  return (
    <div className="sc-header flex shrink-0 items-start">
      <Brandmark />
      {tools}
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** The right-hand column of the screens that are not the paper: the candidate, and nothing else. */
export function SscPhotoColumn() {
  return (
    <aside className="sc-photo-col shrink-0">
      <img src={profileImage} alt="" />
      <span>Your photo appears here</span>
    </aside>
  );
}

export function SscGuide({
  sections,
  minutes,
  forwardOnly,
  sectional,
  startAtSymbols = false,
}: Readonly<{
  sections: readonly GuideSection[];
  minutes?: number;
  forwardOnly: boolean;
  sectional: boolean;
  /** Opens with the symbol table at the top, for a candidate who asked what a colour means. */
  startAtSymbols?: boolean;
}>) {
  const symbols = useRef<HTMLTableElement>(null);
  // Once, as the guide opens: a ref callback would scroll back here on every render behind it.
  useEffect(() => {
    if (startAtSymbols) symbols.current?.scrollIntoView();
  }, [startAtSymbols]);
  const scored = sections.every((section) => section.maxScore !== undefined);
  const timed = sections.some((section) => section.durationSec);

  return (
    <>
      <p className="sc-guide-lead">Please read the following instructions carefully</p>

      <p className="sc-guide-totals">
        <b>Total Number of Questions:</b>{' '}
        {sections.reduce((sum, section) => sum + section.questionCount, 0)}
        {minutes ? (
          <>
            <br />
            <b>Total Time Available:</b> {minutes} Mins
          </>
        ) : null}
      </p>

      <table className="sc-guide-sections">
        <thead>
          <tr>
            <th>Section Name</th>
            <th>Total Number of Questions</th>
            {scored ? <th>Max Score</th> : null}
            {timed ? <th>Time (minutes)</th> : null}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section.id}>
              <td>{section.name}</td>
              <td>{section.questionCount}</td>
              {scored ? <td>{section.maxScore}</td> : null}
              {timed ? (
                <td>{section.durationSec ? `${Math.round(section.durationSec / 60)} Mins` : ''}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sc-symbols-lead">
        The symbols used on the next pages are shown below. Please go through them and understand
        what each means before you start the test.
      </p>

      <table className="sc-symbols" ref={symbols}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <input
                type="radio"
                checked={false}
                readOnly
                tabIndex={-1}
                aria-label="Empty option"
              />
            </td>
            <td>Option not chosen</td>
          </tr>
          <tr>
            <td>
              <input type="radio" checked readOnly tabIndex={-1} aria-label="Chosen option" />
            </td>
            <td>
              Option chosen as your answer (clicking it again takes the answer off, and you can then
              choose another)
            </td>
          </tr>
          <tr>
            <td>
              <span className="sc-chip fresh">1</span>
            </td>
            <td>A question number in blue is one you have not attempted yet</td>
          </tr>
          <tr>
            <td>
              <span className="sc-chip answered">1</span>
            </td>
            <td>A question number in green is one you have answered</td>
          </tr>
          {forwardOnly ? null : (
            <>
              <tr>
                <td>
                  <span className="sc-chip marked">3</span>
                </td>
                <td>
                  You have not answered the question, but have marked it to come back to if time
                  permits
                </td>
              </tr>
              <tr>
                <td>
                  <span className="sc-chip answeredmarked">3</span>
                </td>
                <td>
                  You have answered the question, and marked it to look at again if time permits
                </td>
              </tr>
            </>
          )}
          <tr>
            <td>
              <span className="sc-btn">Save &amp; Next</span>
            </td>
            <td>Takes you to the next question, keeping the answer you chose</td>
          </tr>
          {forwardOnly ? null : (
            <>
              <tr>
                <td>
                  <span className="sc-btn">Previous</span>
                </td>
                <td>Takes you to the previous question</td>
              </tr>
              <tr>
                <td>
                  <span className="sc-btn">Mark for Review</span>
                </td>
                <td>
                  Marks the question to be looked at again. An answer you have given to a marked
                  question is still evaluated, whether or not you return to it.
                </td>
              </tr>
              <tr>
                <td>
                  <span className="sc-btn sc-btn-unmark">Unmark</span>
                </td>
                <td>Takes the mark for review off the question</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <h3>General Instructions:</h3>
      <ol>
        {minutes ? <li>You have {minutes} minutes in all to attempt the questions.</li> : null}
        <li>
          The clock is set at the server, and the countdown at the top right of the screen shows the
          time you have left. When it runs out the examination ends by itself; you do not have to
          submit it.
        </li>
        {sectional ? (
          <li>
            Each section has its own time, and the countdown shows the time left for the section you
            are in. When it runs out, or when you click <b>Next Section</b>, that section closes and
            cannot be opened again.
          </li>
        ) : null}
        <li>The question palette at the right of the screen takes you through the questions.</li>
        <li>
          The arrow above the palette folds it away to give the question the whole screen, and
          brings it back.
        </li>
      </ol>

      <h3>Navigating to a Question</h3>
      <ol>
        {forwardOnly ? (
          <li>
            This examination moves one way only. A question you have left cannot be opened again,
            and none can be marked for review.
          </li>
        ) : (
          <li>
            Click a question number on the palette to go straight to that question. An option you
            have chosen on the question you are leaving stays chosen, and is evaluated.
          </li>
        )}
        <li>
          Click <b>Save &amp; Next</b> to go to the next question in order.
        </li>
        {forwardOnly ? null : (
          <li>
            Click <b>Mark for Review</b> to mark the question you are on; it stays on screen, and
            the button then reads <b>Unmark</b>.
          </li>
        )}
      </ol>

      <h3>Answering a Question</h3>
      <ol>
        <li>To choose your answer, click the button of one of the options.</li>
        <li>To change it, click the button of another option.</li>
        <li>To take it off, click the option you chose once more.</li>
        <li>
          Your answer is recorded as soon as you choose it. An option left chosen is evaluated, so
          take off any answer you do not mean to give.
        </li>
        {forwardOnly ? null : (
          <li className="sc-red">
            An answer given to a question that is marked for review is considered in the evaluation.
          </li>
        )}
      </ol>

      <h3>Navigating through Sections</h3>
      <ol>
        <li>The section you are in is named on the bar above the question.</li>
        {sectional ? (
          <li>
            Sections are taken in order, one at a time, and a section you have left stays closed.
          </li>
        ) : (
          <>
            <li>
              After <b>Save &amp; Next</b> on the last question of a section you are taken to the
              first question of the next one.
            </li>
            <li>You may move between sections and questions at any time during the examination.</li>
          </>
        )}
      </ol>
    </>
  );
}
