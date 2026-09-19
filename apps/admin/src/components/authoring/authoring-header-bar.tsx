import {
  ANSWER_MODE,
  ANSWER_MODES,
  DIFFICULTY_LEVELS,
  MCQ_OPTION_COUNT,
  QUESTION_TYPE,
  QUESTION_TYPES,
  type AnswerMode,
  type DifficultyLevel,
  type QuestionType,
} from '@iace/contracts';
import { Combobox, Input, SegmentedControl, cn } from '@iace/ui';
import { ANSWER_MODE_LABELS, QUESTION_TYPE_LABELS } from '../../lib/constants';
import { SubjectPicker, TopicPicker } from '../taxonomy-picker';
import {
  OPTION_COUNTS,
  withOptionCount,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';

/** Dense on purpose: the whole batch's setting is one row, and the rest of the window is the box. */
/** A choice: a filled chip with nothing to type into. */
const CONTROL = 'h-8 w-auto min-w-32 max-w-52 border-transparent bg-muted px-2 text-xs shadow-none';

/** Something to type into, told apart from the choices beside it by its outline and its ground. */
const FIELD = 'h-8 border-input bg-surface px-2 text-xs shadow-none placeholder:italic';

const CAPTION = 'text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground';

export function AuthoringHeaderBar({
  header,
  state,
  actions,
  subjectLocked = false,
  onHeaderChange,
  onStateChange,
}: Readonly<{
  header: AuthoringHeader;
  state: AuthoringState;
  actions: React.ReactNode;
  /** The section a scoped editor was opened on names the subject; a typist must not write past it. */
  subjectLocked?: boolean;
  onHeaderChange: (next: AuthoringHeader) => void;
  onStateChange: (next: AuthoringState) => void;
}>) {
  const typed = state.type === QUESTION_TYPE.TEXT_FIELD;

  return (
    <div className="flex flex-none items-center gap-x-4 border-b border-border bg-surface px-4 py-2">
      {/* The batch's settings give way first; what a typist presses must never leave the row. */}
      <div className="flex min-w-0 flex-1 items-center gap-x-4 overflow-x-auto">
        <Slot caption="Subject">
          <SubjectPicker
            value={header.subjectId}
            disabled={subjectLocked}
            placeholder="Choose a subject"
            className={CONTROL}
            aria-label="Subject"
            onChange={(subjectId) => onHeaderChange({ ...header, subjectId, topicId: '' })}
          />
        </Slot>

        <Slot caption="Topic">
          <TopicPicker
            value={header.topicId}
            subjectId={header.subjectId}
            placeholder="Any topic"
            clearable
            className={CONTROL}
            aria-label="Topic"
            onChange={(topicId) => onHeaderChange({ ...header, topicId })}
          />
        </Slot>

        <Slot caption="Tags">
          <Input
            value={header.tags}
            placeholder="ssc, time and work"
            aria-label="Tags"
            className={cn(FIELD, 'w-auto min-w-40 max-w-56')}
            onChange={(event) => onHeaderChange({ ...header, tags: event.target.value })}
          />
        </Slot>

        <Slot caption="Difficulty">
          <Combobox
            value={header.difficulty}
            clearable={false}
            className={CONTROL}
            aria-label="Difficulty"
            items={DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level }))}
            onChange={(value) =>
              onHeaderChange({ ...header, difficulty: value as DifficultyLevel })
            }
          />
        </Slot>

        <Slot caption="Type">
          <Combobox
            value={state.type}
            clearable={false}
            className={CONTROL}
            aria-label="Type"
            items={QUESTION_TYPES.map((type) => ({
              value: type,
              label: QUESTION_TYPE_LABELS[type],
            }))}
            onChange={(value) => onStateChange(retyped(state, value as QuestionType))}
          />
        </Slot>

        {typed ? null : (
          <Slot caption="Options">
            <SegmentedControl
              value={String(state.optionCount)}
              aria-label="How many options"
              items={OPTION_COUNTS.map((count) => ({ value: String(count), label: String(count) }))}
              onChange={(value) => onStateChange(withOptionCount(state, Number(value)))}
            />
          </Slot>
        )}

        {typed ? (
          <Slot caption="Answer match">
            <Combobox
              value={state.answerMode}
              clearable={false}
              className={CONTROL}
              aria-label="Answer match"
              items={ANSWER_MODES.map((mode) => ({ value: mode, label: ANSWER_MODE_LABELS[mode] }))}
              onChange={(value) =>
                onStateChange({ ...state, answerMode: value as AnswerMode, tolerance: '' })
              }
            />
          </Slot>
        ) : null}

        {typed && state.answerMode === ANSWER_MODE.NUMERIC ? (
          <Slot caption="Tolerance">
            <Input
              value={state.tolerance}
              inputMode="decimal"
              aria-label="Tolerance"
              className={cn(FIELD, 'w-24')}
              onChange={(event) => onStateChange({ ...state, tolerance: event.target.value })}
            />
          </Slot>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-3">{actions}</div>
    </div>
  );
}

function Slot({ caption, children }: Readonly<{ caption: string; children: React.ReactNode }>) {
  return (
    <label className="flex shrink-0 items-center gap-2">
      <span className={CAPTION}>{caption}</span>
      {children}
    </label>
  );
}

/** A typed answer has no options, so switching type changes the scaffold and not the content. */
function retyped(state: AuthoringState, type: QuestionType): AuthoringState {
  if (type === state.type) return state;
  return {
    ...state,
    type,
    optionCount:
      type === QUESTION_TYPE.SINGLE_MCQ ? state.content.en.options.length || MCQ_OPTION_COUNT : 0,
    answer: '',
  };
}
