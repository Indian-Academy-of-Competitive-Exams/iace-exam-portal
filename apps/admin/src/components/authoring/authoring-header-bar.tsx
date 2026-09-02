import {
  ANSWER_MODE,
  ANSWER_MODES,
  DIFFICULTY_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_TYPE,
  QUESTION_TYPES,
  type AnswerMode,
  type DifficultyLevel,
  type QuestionLanguage,
  type QuestionType,
} from '@iace/contracts';
import { Combobox, Input, SegmentedControl } from '@iace/ui';
import { ANSWER_MODE_LABELS, QUESTION_TYPE_LABELS } from '../../lib/constants';
import { SubjectPicker, TopicPicker } from '../taxonomy-picker';
import {
  OPTION_COUNTS,
  withOptionCount,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';

/** Dense on purpose: the whole batch's setting is one row, and the rest of the window is the box. */
const CONTROL = 'h-8 w-auto min-w-32 max-w-52 border-transparent bg-muted px-2 text-xs shadow-none';

const CAPTION = 'text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground';

export function AuthoringHeaderBar({
  header,
  state,
  language,
  counter,
  actions,
  disabled,
  onHeaderChange,
  onStateChange,
  onLanguageChange,
}: Readonly<{
  header: AuthoringHeader;
  state: AuthoringState;
  language: QuestionLanguage;
  /** Which question of this batch is in the box — a value, not a label. */
  counter: string;
  actions: React.ReactNode;
  disabled: boolean;
  onHeaderChange: (next: AuthoringHeader) => void;
  onStateChange: (next: AuthoringState) => void;
  onLanguageChange: (next: QuestionLanguage) => void;
}>) {
  const typed = state.type === QUESTION_TYPE.TEXT_FIELD;

  return (
    <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2">
      <Slot caption="Subject">
        <SubjectPicker
          value={header.subjectId}
          placeholder="Choose a subject"
          disabled={disabled}
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
          disabled={disabled}
          className={CONTROL}
          aria-label="Topic"
          onChange={(topicId) => onHeaderChange({ ...header, topicId })}
        />
      </Slot>

      <Slot caption="Tags">
        <Input
          value={header.tags}
          disabled={disabled}
          placeholder="Comma separated"
          aria-label="Tags"
          className={CONTROL}
          onChange={(event) => onHeaderChange({ ...header, tags: event.target.value })}
        />
      </Slot>

      <Slot caption="Difficulty">
        <Combobox
          value={header.difficulty}
          disabled={disabled}
          clearable={false}
          className={CONTROL}
          aria-label="Difficulty"
          items={DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(value) => onHeaderChange({ ...header, difficulty: value as DifficultyLevel })}
        />
      </Slot>

      <Slot caption="Type">
        <Combobox
          value={state.type}
          disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
            inputMode="decimal"
            aria-label="Tolerance"
            className="h-8 w-24 border-transparent bg-muted px-2 text-xs shadow-none"
            onChange={(event) => onStateChange({ ...state, tolerance: event.target.value })}
          />
        </Slot>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{counter}</span>
        <SegmentedControl
          value={language}
          onChange={(value) => onLanguageChange(value as QuestionLanguage)}
          aria-label="Language"
          items={LANGUAGE_ORDER.map((code) => ({
            value: code,
            label: code.toUpperCase(),
            name: LANGUAGE_LABELS[code],
          }))}
        />
        {actions}
      </div>
    </div>
  );
}

function Slot({ caption, children }: Readonly<{ caption: string; children: React.ReactNode }>) {
  return (
    <label className="flex items-center gap-2">
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
