/** The Test Summary the banking screen asks with: a tally per section over a dimmed paper, then one button. */
import { X } from 'lucide-react';
import { type ExamSection, type PaletteCounts } from '@iace/contracts';
import { Spinner } from '@iace/ui';
import { useModalBox } from '../../use-modal-box';
import { summaryOf } from './states';

export function BankingSummaryDialog({
  asks,
  confirmLabel,
  sections,
  countsOf,
  pending = false,
  onConfirm,
  onCancel,
}: Readonly<{
  asks: string;
  confirmLabel: string;
  sections: readonly ExamSection[];
  countsOf: (sectionId: string) => PaletteCounts;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const box = useModalBox<HTMLDivElement>(pending ? undefined : onCancel);

  return (
    <div className="bk-overlay absolute inset-0 z-40 grid place-items-center p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal
        aria-labelledby="bk-summary-title"
        className="bk-summary"
      >
        <button
          type="button"
          autoFocus
          aria-label="Close"
          className="bk-summary-close"
          disabled={pending}
          onClick={onCancel}
        >
          <X aria-hidden />
        </button>
        <h1 id="bk-summary-title">Test Summary</h1>
        <p>{asks}</p>

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
              {sections.map((section, at) => {
                const row = summaryOf(countsOf(section.id));
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
            className="bk-summary-submit"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {pending ? <Spinner size="sm" label="Submitting" /> : null}
        </div>
      </div>
    </div>
  );
}
