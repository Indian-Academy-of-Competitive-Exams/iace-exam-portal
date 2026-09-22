/**
 * The SSC/Railway pre-test screens: General Instructions, then the paper's own, with the
 * language and the declaration on the second. Copy is the portal's, verbatim. The sprite
 * legend is the one the sitting draws, so the symbols a candidate is taught here are the
 * symbols they then see.
 */
import {
  contentLanguageOf,
  isReviewState,
  LANGUAGE_LABELS,
  type ExamBrief,
  type LanguageCode,
} from '@iace/contracts';
import { LEGEND_ORDER, STATE_CLASS } from './states';
import { useAuth } from '../../../../providers/auth';
import { type InstructionsView } from '../../instructions/use-instructions';
import './instructions.css';
import './railway.css';

const STEP_TITLES = {
  GENERAL: 'Instructions',
  PAPER: 'Other Important Instructions',
} as const;

export function RailwayInstructions({ view }: Readonly<{ view: InstructionsView }>) {
  const { identity } = useAuth();
  const candidate = identity?.fullName ?? 'Candidate';

  return (
    <div data-exam-template="ssc_railways" className="ri-page flex h-dvh flex-col">
      <div className="ri-logobar flex items-center justify-center">
        <span className="rw-logo">IACE</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <div className="ri-panel flex min-w-0 flex-1 flex-col">
          <div className="ri-panelhead flex items-center justify-between">
            <span>{STEP_TITLES[view.step]}</span>
            <ViewIn view={view} />
          </div>

          <div className="ri-body min-h-0 flex-1 overflow-y-auto">
            {view.step === 'GENERAL' ? (
              <GeneralScreen forwardOnly={view.forwardOnly} />
            ) : (
              <PaperScreen view={view} />
            )}
          </div>

          <div className="ri-panelfoot flex items-center justify-between">
            {view.step === 'GENERAL' ? (
              <span />
            ) : (
              <button type="button" className="ri-btn" onClick={view.back}>
                &lt; Previous
              </button>
            )}
            {view.step === 'GENERAL' ? (
              <button type="button" className="ri-btn" onClick={view.next}>
                Next &gt;
              </button>
            ) : (
              <button
                type="button"
                className="ri-btn ri-begin"
                disabled={!view.ready}
                onClick={view.begin}
              >
                I am ready to begin
              </button>
            )}
          </div>
        </div>

        <aside className="ri-student shrink-0">
          <div className="ri-avatar" aria-hidden />
          <p className="ri-name">{candidate}</p>
        </aside>
      </div>
    </div>
  );
}

function ViewIn({ view }: Readonly<{ view: InstructionsView }>) {
  if (view.brief.languages.length < 2) return null;

  return (
    <label className="ri-viewin">
      <span>View in</span>
      <select
        value={view.language}
        onChange={(event) => view.chooseLanguage(event.target.value as LanguageCode)}
      >
        {view.brief.languages.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[contentLanguageOf(code)]}
          </option>
        ))}
      </select>
    </label>
  );
}

function GeneralScreen({ forwardOnly }: Readonly<{ forwardOnly: boolean }>) {
  return (
    <>
      <p className="ri-lead">General Instructions:</p>
      <p>
        1. The clock will be set at the server. The countdown timer at the top right corner of
        screen will display the remaining time available for you to complete the examination. When
        the timer reaches zero, the examination will end by itself. You will not be required to end
        or submit your examination.
      </p>
      <p>
        2. The Question Palette displayed on the right side of screen will show the status of each
        question using one of the following symbols:
      </p>

      <ul className="ri-legend">
        {LEGEND_ORDER.filter((state) => !forwardOnly || !isReviewState(state)).map((state) => (
          <li key={state}>
            <span className={`rw-cell ${STATE_CLASS[state]}`} aria-hidden />
            <span>{LEGEND_SAYS[state]}</span>
          </li>
        ))}
      </ul>

      {forwardOnly ? null : (
        <p>
          The <b>Marked for Review</b> status for a question simply indicates that you would like to
          look at that question again. If a question is answered, but marked for review, then the
          answer will be considered for evaluation unless the status is modified by the candidate.
        </p>
      )}

      <p className="ri-lead ri-underline">Navigating to a Question:</p>
      <p>To answer a question, do the following:</p>

      {forwardOnly ? (
        <>
          <ul className="ri-plain">
            <li>
              Click on <b>Save &amp; Next</b> to save your answer for the current question and then
              go to the next question.
            </li>
            <li>
              This examination moves in one direction only. A question you have left cannot be
              opened again, and there is no marking a question for review.
            </li>
          </ul>
          <p>
            Note: note that a question you move away from is closed for the rest of the examination,
            whether or not you answered it.
          </p>
        </>
      ) : (
        <>
          <ul className="ri-plain">
            <li>
              Click on the question number in the Question Palette at the right of your screen to go
              to that numbered question directly.
            </li>
            <li>
              Click on <b>Save &amp; Next</b> to save your answer for the current question and then
              go to the next question.
            </li>
            <li>
              Click on <b>Mark for Review &amp; Next</b> to save your answer for the current
              question, mark it for review, and then go to the next question.
            </li>
          </ul>
          <p>
            Note: note that your answer for the current question will not be saved, if you navigate
            to another question directly by clicking on a question number without saving the answer
            to the previous question.
          </p>
        </>
      )}
    </>
  );
}

const LEGEND_SAYS: Readonly<Record<(typeof LEGEND_ORDER)[number], string>> = {
  ANSWERED: 'You have answered the question.',
  NOT_ANSWERED: 'You have not answered the question.',
  NOT_VISITED: 'You have not visited the question yet.',
  MARKED_REVIEW: 'You have NOT answered the question, but have marked the question for review.',
  ANSWERED_MARKED:
    'The question(s) "Answered and Marked for Review" will be considered for evaluation.',
};

function PaperScreen({ view }: Readonly<{ view: InstructionsView }>) {
  const { brief } = view;
  const marks = brief.sections.reduce(
    (total, section) => total + section.questionCount * section.marksPerQuestion,
    0,
  );
  const penalty = brief.sections.find((section) => section.negativeMarks > 0)?.negativeMarks ?? 0;

  return (
    <>
      <p className="ri-lead ri-underline">Other Important Instructions</p>
      {brief.title ? <p className="ri-lead ri-underline">{brief.title}</p> : null}

      <p>{`Duration: ${Math.round(brief.durationSec / 60)} Mins Maximum Marks: ${marks}`}</p>
      <p>Read the following instructions carefully.</p>

      <ol className="ri-plain">
        {rulesFor(brief, penalty).map((rule, at) => (
          <li key={rule}>{`${at + 1}. ${rule}`}</li>
        ))}
      </ol>

      <div className="ri-choose">
        <label className="ri-viewin">
          <span>Choose your default language:</span>
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
        <p className="ri-note">
          Please note all questions will appear in your default language. This language can be
          changed for a particular question later on.
        </p>
      </div>

      <label className="ri-declare">
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
    </>
  );
}

/** The original numbers its own lines, so a paper without negative marking must not skip one. */
function rulesFor(brief: ExamBrief, penalty: number): string[] {
  const minutes = Math.round(brief.durationSec / 60);
  const sections =
    brief.sections.length === 1 ? 'one section' : `${brief.sections.length} sections`;

  return [
    `The test contain only ${sections} having ${brief.totalQuestions} total questions.`,
    'Each question has 4 options out of which only one is correct.',
    `You have to finish the test in ${minutes} minutes.`,
    ...(penalty > 0
      ? [
          'You not to guess the answer as there is negative marking.',
          `You will be awarded marks for each correct answer and ${penalty} marks will be deducted for each wrong answer.`,
          'There is no negative marking for the questions that you have not attempted.',
        ]
      : []),
    'you can write this test only once. Make sure that you complete the test before you submit the test and / or close the browser.',
  ];
}
