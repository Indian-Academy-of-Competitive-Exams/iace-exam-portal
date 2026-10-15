import { TIMER_KIND, type ExamView } from '@iace/app-kit';
import { SscPhotoColumn } from './instructions';
import { summaryOf } from './states';

/** The summary a candidate confirms before a section, or the paper, is handed in. */
export function SscLeaving({
  view,
  ofSection,
  onClose,
}: Readonly<{ view: ExamView; ofSection: boolean; onClose: () => void }>) {
  const { submitSection } = view;
  const sectional = view.timer.kind === TIMER_KIND.SECTION;

  return (
    <div className="flex min-h-0 flex-1">
      {ofSection ? (
        <ExamSummary
          view={view}
          sectionIds={[view.sectionId]}
          confirmLabel="Next Section"
          onConfirm={() => {
            onClose();
            submitSection?.();
          }}
          onCancel={onClose}
        />
      ) : (
        <ExamSummary
          view={view}
          sectionIds={sectional ? [view.sectionId] : view.sections.map((row) => row.id)}
          confirmLabel="Submit Test"
          pending={view.submit.isPending}
          onConfirm={view.submit.confirm}
          onCancel={view.submit.cancel}
        />
      )}
      <SscPhotoColumn />
    </div>
  );
}

/** What this screen asks with: a tally, the question under it and two plain buttons, then a word while it goes in. */
function ExamSummary({
  view,
  sectionIds,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: Readonly<{
  view: ExamView;
  sectionIds: readonly string[];
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="sc-summary min-w-0 flex-1">
      <h1>Exam Summary</h1>
      <table>
        <thead>
          <tr>
            <th>Section Name</th>
            <th>No of Questions</th>
            <th>Answered</th>
            <th>Not Answered</th>
            {view.forwardOnly ? null : <th>Marked for Review</th>}
            <th>Not Visited</th>
          </tr>
        </thead>
        <tbody>
          {view.sections
            .filter((section) => sectionIds.includes(section.id))
            .map((section) => {
              const row = summaryOf(view.sectionCounts(section.id));
              return (
                <tr key={section.id}>
                  <td>{section.name}</td>
                  <td>{section.questionCount}</td>
                  <td>{row.answered}</td>
                  <td>{row.notAnswered}</td>
                  {view.forwardOnly ? null : <td>{row.marked}</td>}
                  <td>{row.notVisited}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {pending ? (
        <p className="sc-wait">Please Wait ...</p>
      ) : (
        <>
          <p>Are you sure you want to submit?</p>
          <div className="flex items-center justify-center">
            <button type="button" autoFocus onClick={onCancel}>
              Back
            </button>
            <button type="button" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
