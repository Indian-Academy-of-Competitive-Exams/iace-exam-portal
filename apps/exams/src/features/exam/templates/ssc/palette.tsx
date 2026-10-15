import { ANSWER_STATE, isStateShown } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { cn } from '@iace/ui';
import { ANALYTICS_ORDER, STATE_CLASS, STATE_LABEL } from './states';

export function SscSide({
  view,
  open,
  onToggle,
  onOpen,
}: Readonly<{
  view: ExamView;
  open: boolean;
  onToggle: () => void;
  onOpen: (questionId: string) => void;
}>) {
  return (
    <aside className="sc-side flex min-h-0 shrink-0 flex-col">
      <button
        type="button"
        aria-label={open ? 'Collapse question palette' : 'Expand question palette'}
        className="sc-fold"
        onClick={onToggle}
      />
      {open ? <SscPalette view={view} onOpen={onOpen} /> : null}
    </aside>
  );
}

/** The section's question chips and the tally under them. */
function SscPalette({
  view,
  onOpen,
}: Readonly<{ view: ExamView; onOpen: (questionId: string) => void }>) {
  const section = view.sections.find((row) => row.id === view.sectionId);
  const counts = view.sectionCounts(view.sectionId);

  return (
    <>
      <div className="sc-palette min-h-0">
        <p>{section?.name} :</p>
        <div className="sc-grid">
          {view.questions.map((row, index) => {
            const state = view.answers[row.questionId]?.state ?? ANSWER_STATE.NOT_VISITED;
            return (
              <button
                key={row.questionId}
                type="button"
                aria-current={row.questionId === view.question?.questionId}
                disabled={!view.canOpen(row.questionId)}
                aria-label={`Question ${index + 1}, ${STATE_LABEL[state]}`}
                className={cn('sc-chip', STATE_CLASS[state])}
                onClick={() => onOpen(row.questionId)}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sc-analytics shrink-0">
        <p>Analytics</p>
        <table>
          <tbody>
            {ANALYTICS_ORDER.filter((state) => isStateShown(state, view.forwardOnly)).map(
              (state) => (
                <tr key={state}>
                  <td>{STATE_LABEL[state]}</td>
                  <td>
                    <b>{counts[state]}</b>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
