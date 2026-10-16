/**
 * The Banking pre-test screens: the general instructions, then the paper's own, with the
 * language and the declaration pinned under them. The legend draws the sitting's own
 * symbols, so what a candidate is taught here is what they then see.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ANSWER_STATE,
  contentLanguageOf,
  isStateShown,
  LANGUAGE_LABELS,
  type AnswerState,
  type ExamBrief,
  type LanguageCode,
} from '@iace/contracts';
import { NEEDS_KEYBOARD_SAYS, needsKeyboard } from '@iace/app-kit';
import { Alert } from '@iace/ui';
import { type InstructionsView } from '../../use-instructions';
import profileImage from '../railway/assets/profile.png';
import { STATE_CLASS } from './states';
import './banking.css';

const STEP_TITLES = {
  GENERAL: 'Instructions',
  PAPER: 'Other Important Instructions',
} as const;

export function BankingInstructions({ view }: Readonly<{ view: InstructionsView }>) {
  const general = view.step === 'GENERAL';

  return (
    <div data-exam-template="banking" className="bi-page flex h-dvh flex-col">
      <div className="bi-header shrink-0">
        <h1>{view.brief.title}</h1>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="bi-main flex min-w-0 flex-1 flex-col">
          <div className="bi-band shrink-0">{STEP_TITLES[view.step]}</div>

          <div className="bi-scroll min-h-0 flex-1">
            <div className="bi-content">
              {needsKeyboard(view.brief) ? (
                <Alert variant="info" className="mt-2.5">
                  {NEEDS_KEYBOARD_SAYS}
                </Alert>
              ) : null}
              {general ? (
                <BankingGeneral
                  minutes={Math.round(view.brief.durationSec / 60)}
                  forwardOnly={view.forwardOnly}
                  sectional={view.sectional}
                />
              ) : (
                <PaperScreen brief={view.brief} />
              )}
            </div>
          </div>

          {general ? (
            <div className="bi-footer flex shrink-0 items-center justify-end">
              <button type="button" className="bi-btn" onClick={view.next}>
                Next <ChevronRight aria-hidden />
              </button>
            </div>
          ) : (
            <Confirmation view={view} />
          )}
        </div>

        <aside className="bi-side shrink-0">
          <img src={profileImage} alt="" />
        </aside>
      </div>
    </div>
  );
}

/** Read before the paper opens and again from inside it, so the two cannot describe different papers. */
export function BankingGeneral({
  minutes,
  forwardOnly,
  sectional,
}: Readonly<{ minutes?: number; forwardOnly: boolean; sectional: boolean }>) {
  return (
    <>
      <h3>General Instructions:</h3>
      <ol>
        {minutes ? (
          <li>
            Total duration of examination is <strong>{minutes}</strong> minutes.
          </li>
        ) : null}
        <li>
          The clock will be set at the server. The countdown timer in the top right corner of screen
          will display the remaining time available for you to complete the examination. When the
          timer reaches zero, the examination will end by itself. You will not be required to end or
          submit your examination.
        </li>
        {sectional ? (
          <li>
            Each section of this examination has its own time, and the countdown timer shows the
            time left for the section you are in. When it reaches zero that section closes, and its
            questions cannot be opened again. Clicking <strong>Submit Section</strong> closes it
            sooner, in the same way.
          </li>
        ) : null}
        <li>
          The Question Palette displayed on the right side of screen will show the status of each
          question using one of the following symbols:
          <table className="bi-legend">
            <tbody>
              {TAUGHT_ORDER.filter((state) => isStateShown(state, forwardOnly)).map((state, at) => (
                <tr key={state}>
                  <td>
                    <span className={`bk-cell ${STATE_CLASS[state]}`} aria-hidden>
                      {at + 1}
                    </span>
                  </td>
                  <td>{LEGEND_SAYS[state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </li>
        {forwardOnly ? null : (
          <li>
            The Marked for Review status for a question simply indicates that you would like to look
            at that question again.{' '}
            <i className="bi-red">
              If a question is answered and Marked for Review, your answer for that question will be
              considered in the evaluation.
            </i>
          </li>
        )}
        <li>
          You can click on the &quot;&gt;&quot; arrow which appears to the left of question palette
          to collapse the question palette thereby maximizing the question window. To view the
          question palette again, you can click on &quot;&lt;&quot; which appears on the right side
          of question window.
        </li>
        <li>
          Where a question is longer than the question area, use the Up and Down arrow keys or drag
          the scroll bar to read the rest of it. The mouse wheel does not move the question.
        </li>
      </ol>

      <h3>Navigating to a Question:</h3>
      <ol>
        <li>
          To answer a question, do the following:
          <ol>
            {forwardOnly ? (
              <li>
                This examination moves in one direction only. A question you have left cannot be
                opened again, and there is no marking a question for review.
              </li>
            ) : (
              <li>
                Click on the question number in the Question Palette at the right of your screen to
                go to that numbered question directly. An option you have chosen on the current
                question stays chosen, and is evaluated.
              </li>
            )}
            <li>
              Click on <strong>Save &amp; Next</strong> to go to the next question, keeping the
              answer you chose.
            </li>
            {forwardOnly ? null : (
              <li>
                Click on <strong>Mark for Review &amp; Next</strong> to mark the current question
                for review, keeping the answer you chose, and then go to the next question.
              </li>
            )}
          </ol>
        </li>
      </ol>

      <h3>Answering a Question :</h3>
      <ol>
        <li>
          Procedure for answering a multiple choice type question:
          <ol>
            <li>To select your answer, click on the button of one of the options</li>
            <li>
              To deselect your chosen answer, click on the <strong>Clear Response</strong> button
            </li>
            <li>To change your chosen answer, click on the button of another option</li>
            <li>
              Your answer is recorded as soon as you choose it; clicking{' '}
              <strong>Save &amp; Next</strong> is not needed for it to count
            </li>
          </ol>
        </li>
        <li>
          Note that EVERY question with an option left chosen is considered for evaluation, whether
          or not it is marked for review. Clear any answer you do not mean to give.
        </li>
      </ol>

      <h3>Navigating through sections:</h3>
      <ol>
        <li>
          Sections in this question paper are displayed on the top bar of the screen. The section
          you are currently viewing is highlighted.
        </li>
        <li>
          After clicking the Save &amp; Next button on the last question for a section, you will
          automatically be taken to the first question of the next section.
        </li>
        <li>
          Candidate can view the corresponding section summary as part of the legend that appears in
          every section above the question palette.
        </li>
      </ol>
    </>
  );
}

/** The order a candidate meets them in: untouched first, as the instructions number them. */
const TAUGHT_ORDER: readonly AnswerState[] = [
  ANSWER_STATE.NOT_VISITED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
];

const LEGEND_SAYS: Readonly<Record<AnswerState, string>> = {
  NOT_VISITED: 'You have not visited the question yet.',
  NOT_ANSWERED: 'You have not answered the question.',
  ANSWERED: 'You have answered the question.',
  MARKED_REVIEW: 'You have NOT answered the question, but have marked the question for review.',
  ANSWERED_MARKED:
    'The question(s) "Answered and Marked for Review" will be considered for evaluation.',
};

/** The paper's own figures, section by section: nothing here is the same on two papers. */
function PaperScreen({ brief }: Readonly<{ brief: ExamBrief }>) {
  return (
    <table className="bi-sections">
      <thead>
        <tr>
          <th>Section</th>
          <th>Questions</th>
          <th>Marks per question</th>
          <th>Negative marks</th>
          {brief.sections.some((section) => section.durationSec) ? <th>Minutes</th> : null}
        </tr>
      </thead>
      <tbody>
        {brief.sections.map((section) => (
          <tr key={section.id}>
            <td>{section.name}</td>
            <td>{section.questionCount}</td>
            <td>{section.marksPerQuestion}</td>
            <td>{section.negativeMarks}</td>
            {section.durationSec ? <td>{Math.round(section.durationSec / 60)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Confirmation({ view }: Readonly<{ view: InstructionsView }>) {
  return (
    <div className="bi-confirm shrink-0">
      {view.dual ? null : (
        <>
          <label className="bi-choose">
            <span>Choose your default language :</span>
            <select
              value={view.language}
              onChange={(event) => view.chooseLanguage(event.target.value as LanguageCode)}
            >
              <option value="">--Select--</option>
              {view.brief.languages.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[contentLanguageOf(code)]}
                </option>
              ))}
            </select>
          </label>
          <p className="bi-alert">
            Please note all questions will appear in your default language.
          </p>
        </>
      )}

      <label className="bi-declare">
        <input
          type="checkbox"
          checked={view.declared}
          onChange={(event) => view.declare(event.target.checked)}
        />
        <span>
          I have read and understood the instructions. All computer hardware allotted to me are in
          proper working condition. I declare that I am not in possession of / not wearing / not
          carrying any prohibited gadget like mobile phone, bluetooth devices etc. /any prohibited
          material with me into the Examination Hall. I agree that in case of not adhering to the
          instructions, I shall be liable to be debarred from this Test and/or to disciplinary
          action, which may include ban from future Tests / Examinations.
        </span>
      </label>

      <div className="bi-actions flex items-center justify-between">
        <button type="button" className="bi-btn" onClick={view.back}>
          <ChevronLeft aria-hidden /> Previous
        </button>
        <button
          type="button"
          className="bi-btn bi-btn-filled"
          disabled={!view.ready}
          onClick={view.begin}
        >
          I am ready to begin
        </button>
      </div>
    </div>
  );
}
