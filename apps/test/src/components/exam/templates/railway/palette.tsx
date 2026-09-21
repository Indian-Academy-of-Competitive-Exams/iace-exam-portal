import { ANSWER_STATE, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { cn } from '@iace/ui';
import profileImage from './assets/profile.png';

/** Sprite offsets, not colours: the original draws all five states from one image. */
const CELL: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'notvisited4',
  [ANSWER_STATE.NOT_ANSWERED]: 'notanswered2',
  [ANSWER_STATE.ANSWERED]: 'answered1',
  [ANSWER_STATE.MARKED_REVIEW]: 'markforreview3',
  [ANSWER_STATE.ANSWERED_MARKED]: 'selectd markforreview3',
};

const SWATCH: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'notvisited',
  [ANSWER_STATE.NOT_ANSWERED]: 'notanswered',
  [ANSWER_STATE.ANSWERED]: 'answered',
  [ANSWER_STATE.MARKED_REVIEW]: 'markforreview',
  [ANSWER_STATE.ANSWERED_MARKED]: 'selectd-check',
};

/** The original's wording, kept verbatim — this skin reproduces a screen, it does not reword one. */
const LEGEND: readonly { state: AnswerState; label: string }[] = [
  { state: ANSWER_STATE.ANSWERED, label: 'Answered' },
  { state: ANSWER_STATE.NOT_ANSWERED, label: 'Not Answered' },
  { state: ANSWER_STATE.NOT_VISITED, label: 'Not Visited' },
  { state: ANSWER_STATE.MARKED_REVIEW, label: 'Marked for Review' },
  {
    state: ANSWER_STATE.ANSWERED_MARKED,
    label: 'Answered and Marked for Review (will be considered for evaluation)',
  },
];

export function RailwayPalette({
  questionIds,
  answers,
  currentId,
  counts,
  candidate,
  onOpen,
  onSubmit,
}: Readonly<{
  questionIds: readonly string[];
  answers: Readonly<Record<string, LiveAnswer>>;
  currentId: string | null;
  counts: Readonly<Record<AnswerState, number>>;
  candidate: string;
  onOpen: (questionId: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <div className="quepalette flex h-full flex-col">
      <div className="flex items-center gap-3 bg-white px-3 py-2">
        <img src={profileImage} alt="" className="h-10 w-10" />
        <span className="text-sm">{`Welcome ${candidate}`}</span>
      </div>

      <table className="legend w-full px-2 py-2">
        <tbody>
          {pairs(LEGEND).map(([left, right]) => (
            <tr key={left.state}>
              <LegendCell entry={left} count={counts[left.state]} wide={!right} />
              {right ? <LegendCell entry={right} count={counts[right.state]} /> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bottom-legend">Questions Palette</div>

      <div className="quenmbrpalt shrink-0">
        <p className="px-2 pb-1 text-xs font-bold">Choose a Question</p>
        <div className="quenmbrgrid">
          {questionIds.map((id, index) => {
            const state = answers[id]?.state ?? ANSWER_STATE.NOT_VISITED;
            return (
              <button
                key={id}
                type="button"
                aria-current={id === currentId}
                aria-label={`Question ${index + 1}, ${state}`}
                className={cn('quetype1', CELL[state])}
                onClick={() => onOpen(id)}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="palettebottom flex justify-center py-3">
        <button type="button" className="rw-submit" onClick={onSubmit}>
          Submit
        </button>
      </div>
    </div>
  );
}

function LegendCell({
  entry,
  count,
  wide,
}: Readonly<{ entry: { state: AnswerState; label: string }; count: number; wide?: boolean }>) {
  return (
    <>
      <td className="w-9 py-1 align-top">
        <span className={cn('quetype inline-block', SWATCH[entry.state])}>{count}</span>
      </td>
      <td className="py-1 pr-2 align-top" colSpan={wide ? 3 : 1}>
        {entry.label}
      </td>
    </>
  );
}

/** The original lays the legend out two across, with the long last row on its own. */
function pairs<T>(rows: readonly T[]): (readonly [T, T | undefined])[] {
  return rows.flatMap((row, index) => (index % 2 === 0 ? [[row, rows[index + 1]] as const] : []));
}
