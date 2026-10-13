/** The Test Summary the banking screen asks with: every section's tally over a dimmed paper, then one Submit. */
import { X } from 'lucide-react';
import { type ExamView } from '@iace/app-kit';
import { Spinner } from '@iace/ui';
import { summaryOf } from './states';

export function BankingSubmitDialog({ view }: Readonly<{ view: ExamView }>) {
  const { submit } = view;

  return (
    <div className="bk-overlay absolute inset-0 z-40 grid place-items-center p-4">
      <div role="dialog" aria-modal aria-labelledby="bk-summary-title" className="bk-summary">
        <button
          type="button"
          aria-label="Close"
          className="bk-summary-close"
          disabled={submit.isPending}
          onClick={submit.cancel}
        >
          <X aria-hidden />
        </button>
        <h1 id="bk-summary-title">Test Summary</h1>
        <p>Do you want to Submit the Test?</p>

        <div className="bk-summary-scroll">
          <table>
            <thead>
              <tr>
                <th>S. No.</th>
                <th>Section Name</th>
                <th>No. of Questions</th>
                <th>Answered</th>
                <th>Not Answered</th>
                <th>Not Visited</th>
              </tr>
            </thead>
            <tbody>
              {view.sections.map((section, at) => {
                const row = summaryOf(view.sectionCounts(section.id));
                return (
                  <tr key={section.id}>
                    <td>{at + 1}</td>
                    <td>{section.name}</td>
                    <td>{section.questionCount}</td>
                    <td>{row.answered}</td>
                    <td>{row.notAnswered}</td>
                    <td>{row.notVisited}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            autoFocus
            className="bk-summary-submit"
            disabled={submit.isPending}
            onClick={submit.confirm}
          >
            Submit
          </button>
          {submit.isPending ? <Spinner size="sm" label="Submitting" /> : null}
        </div>
      </div>
    </div>
  );
}
