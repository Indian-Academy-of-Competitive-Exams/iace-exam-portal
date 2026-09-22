import { ANSWER_STATE, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { cn } from '@iace/ui';
import profileImage from './assets/profile.png';
import { STATE_CLASS, STATE_LABEL, StateSwatch } from './states';
import { ScrollPane } from './scroll-pane';

export function RailwayPalette({
  questionIds,
  answers,
  currentId,
  counts,
  candidate,
  states,
  canOpen,
  onOpen,
}: Readonly<{
  questionIds: readonly string[];
  answers: Readonly<Record<string, LiveAnswer>>;
  currentId: string | null;
  counts: Readonly<Record<AnswerState, number>>;
  candidate: string;
  /** The states this paper can reach, in the order the legend reads them. */
  states: readonly AnswerState[];
  canOpen: (questionId: string) => boolean;
  onOpen: (questionId: string) => void;
}>) {
  return (
    <>
      <div className="rightmenuClass flex shrink-0 items-center gap-3">
        <img src={profileImage} alt="" className="h-10 w-10" />
        <span className="stdntinfo">{`Welcome ${candidate}`}</span>
      </div>

      <table className="paleet-data legend w-full shrink-0">
        <tbody>
          {pairs(states).map(([left, right]) => (
            <tr key={left}>
              <LegendCell state={left} count={counts[left]} wide={!right} />
              {right ? <LegendCell state={right} count={counts[right]} /> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="hdngpalt shrink-0">
        <p className="bottom-legend">Questions Palette</p>
      </div>

      <div className="question-choose shrink-0">Choose a Question</div>

      <ScrollPane className="quenmbrpalt min-h-0 flex-1">
        <div className="quenmbrgrid">
          {questionIds.map((id, index) => {
            const state = answers[id]?.state ?? ANSWER_STATE.NOT_VISITED;
            return (
              <button
                key={id}
                type="button"
                aria-current={id === currentId}
                disabled={!canOpen(id)}
                aria-label={`Question ${index + 1}, ${STATE_LABEL[state]}`}
                className={cn('rw-cell', STATE_CLASS[state])}
                onClick={() => onOpen(id)}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </ScrollPane>
    </>
  );
}

function LegendCell({
  state,
  count,
  wide,
}: Readonly<{ state: AnswerState; count: number; wide?: boolean }>) {
  return (
    <>
      <td className="w-11 py-1.5 pl-4 align-middle">
        <StateSwatch state={state} count={count} />
      </td>
      <td className="py-1.5 pl-1 pr-3 align-middle" colSpan={wide ? 3 : 1}>
        {STATE_LABEL[state]}
      </td>
    </>
  );
}

/** The original lays the legend out two across, with the long last row on its own. */
function pairs<T>(rows: readonly T[]): (readonly [T, T | undefined])[] {
  return rows.flatMap((row, index) => (index % 2 === 0 ? [[row, rows[index + 1]] as const] : []));
}
