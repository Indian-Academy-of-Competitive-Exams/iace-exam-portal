import { type ExamView } from '@iace/app-kit';
import { cn } from '@iace/ui';
import { READING, answeredOf, type Reading } from './states';
import { answersByKeyboard } from '../../../typing/typing-figures';

/** The band above the paper: the links, the running count, and the bar of sections and moves. */
export function SscBand({
  view,
  reading,
  onRead,
  onOpenCalculator,
  onHandIn,
}: Readonly<{
  view: ExamView;
  reading: Reading | null;
  onRead: (reading: Reading) => void;
  onOpenCalculator?: () => void;
  onHandIn: () => void;
}>) {
  const counts = view.sectionCounts(view.sectionId);

  return (
    <div className="sc-band shrink-0">
      <div className="flex items-start justify-between">
        <div className="sc-links flex flex-wrap">
          <button type="button" onClick={() => onRead(READING.SYMBOLS)}>
            SYMBOLS
          </button>
          <button type="button" onClick={() => onRead(READING.INSTRUCTIONS)}>
            INSTRUCTIONS
          </button>
          {onOpenCalculator ? (
            <button type="button" onClick={onOpenCalculator}>
              CALCULATOR
            </button>
          ) : null}
        </div>
        <p className="sc-total">
          Total Questions answered : <b>{answeredOf(counts)}</b>
        </p>
      </div>

      {reading ? null : <SscBar view={view} onHandIn={onHandIn} />}
    </div>
  );
}

function SscBar({ view, onHandIn }: Readonly<{ view: ExamView; onHandIn: () => void }>) {
  const { submitSection } = view;
  const off = view.locked !== null;
  const previous = view.questions[view.questionIndex - 1];

  return (
    <div className="sc-bar flex flex-wrap items-center justify-between">
      <div className="flex min-w-0 flex-wrap">
        {view.sections
          .filter((row) => view.reachable.includes(row.id))
          .map((row) => (
            <button
              key={row.id}
              type="button"
              className={cn('sc-tab', row.id === view.sectionId && 'active')}
              disabled={off}
              onClick={() => view.openSection(row.id)}
            >
              {row.name}
            </button>
          ))}
      </div>
      <div className="sc-buttons flex flex-wrap">
        {view.forwardOnly ? null : (
          <>
            <button
              type="button"
              className="sc-btn"
              disabled={off || !previous || !view.canOpen(previous.questionId)}
              onClick={() => previous && view.openQuestion(previous.questionId)}
            >
              Previous
            </button>
            <button
              type="button"
              className={cn('sc-btn', view.marked && 'sc-btn-unmark')}
              disabled={off}
              onClick={view.toggleMark}
            >
              {view.marked ? 'Unmark' : 'Mark for Review'}
            </button>
          </>
        )}
        <button
          type="button"
          className="sc-btn"
          disabled={off || answersByKeyboard(view.question)}
          onClick={view.clearResponse}
        >
          Clear Response
        </button>
        <button type="button" className="sc-btn" disabled={off} onClick={view.nextQuestion}>
          Save &amp; Next
        </button>
        {submitSection ? (
          <button type="button" className="sc-btn" disabled={off} onClick={onHandIn}>
            Next Section
          </button>
        ) : (
          <button type="button" className="sc-btn" disabled={off} onClick={view.submit.ask}>
            Submit
          </button>
        )}
      </div>
    </div>
  );
}
