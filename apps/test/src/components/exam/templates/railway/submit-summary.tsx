/**
 * What the original asks instead of a dialog: the paper's tally, section by section,
 * drawn over the question area with the palette folded away. The counts are the same
 * ones the palette reads, so the summary cannot disagree with the grid behind it.
 */
import { ANSWER_STATE, type AnswerState } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { LEGEND_ORDER, STATE_LABEL } from './states';

/** The legend spells this one out further; a column header does not have the width. */
const HEADER: Readonly<Record<AnswerState, string>> = {
  ...STATE_LABEL,
  [ANSWER_STATE.ANSWERED_MARKED]: 'Answered and Marked for Review',
};

export function RailwaySubmitSummary({ view }: Readonly<{ view: ExamView }>) {
  const { submit } = view;
  const total = view.sections.reduce((sum, section) => sum + section.questionCount, 0);

  return (
    <div className="rw-summary">
      <table>
        <thead>
          <tr>
            <th>Section Name</th>
            <th>Total Questions</th>
            {LEGEND_ORDER.map((state) => (
              <th key={state}>{HEADER[state]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.sections.map((section) => (
            <tr key={section.id}>
              <td>{section.name}</td>
              <td>{section.questionCount}</td>
              {LEGEND_ORDER.map((state) => (
                <td key={state}>{view.sectionCounts[section.id]?.[state] ?? 0}</td>
              ))}
            </tr>
          ))}
          <tr>
            <td>
              <b>Total</b>
            </td>
            <td>{total}</td>
            {LEGEND_ORDER.map((state) => (
              <td key={state}>{view.counts[state]}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <p className="rw-ask">Do you want to submit the online exam</p>

      <div className="rw-ask-buttons flex justify-center gap-3">
        <button
          type="button"
          className="rw-ask-btn"
          disabled={submit.isPending}
          onClick={submit.confirm}
        >
          Yes
        </button>
        <button type="button" className="rw-ask-btn" onClick={submit.cancel}>
          No
        </button>
      </div>
    </div>
  );
}
