import {
  ANSWER_MODE,
  ANSWER_MODES,
  DIFFICULTY_LEVELS,
  MCQ_OPTION_COUNT,
  QUESTION_TYPE,
  QUESTION_TYPES,
  TAGS_MAX,
  type AnswerMode,
  type DifficultyLevel,
  type QuestionType,
} from '@iace/contracts';
import { Combobox, Field, Input, MultiCombobox } from '@iace/ui';
import { ANSWER_MODE_LABELS, QUESTION_TYPE_LABELS } from '../../lib/constants';
import { SubjectPicker, TopicPicker } from '../taxonomy-picker';
import { type AuthoringHeader, type AuthoringState } from './question-scaffold';

/** Set once and kept for every question after it — fifty quant questions touch this row once. */
export function AuthoringHeaderBar({
  header,
  state,
  tagOptions,
  disabled,
  onHeaderChange,
  onStateChange,
}: Readonly<{
  header: AuthoringHeader;
  state: AuthoringState;
  tagOptions: readonly string[];
  disabled: boolean;
  onHeaderChange: (next: AuthoringHeader) => void;
  onStateChange: (next: AuthoringState) => void;
}>) {
  const typed = state.type === QUESTION_TYPE.TEXT_FIELD;

  return (
    <div className="grid grid-cols-2 gap-3 border-b border-border pb-4 md:grid-cols-3 xl:grid-cols-6">
      <Field htmlFor="authoring-subject" label="Subject">
        {(control) => (
          <SubjectPicker
            {...control}
            value={header.subjectId}
            placeholder="Choose a subject"
            disabled={disabled}
            onChange={(subjectId) => onHeaderChange({ ...header, subjectId, topicId: '' })}
          />
        )}
      </Field>

      <Field htmlFor="authoring-topic" label="Topic" /* ui-copy-ok: rule */ hint="Optional">
        {(control) => (
          <TopicPicker
            {...control}
            value={header.topicId}
            subjectId={header.subjectId}
            placeholder="Choose a topic"
            clearable
            disabled={disabled}
            onChange={(topicId) => onHeaderChange({ ...header, topicId })}
          />
        )}
      </Field>

      <Field htmlFor="authoring-difficulty" label="Difficulty">
        {(control) => (
          <Combobox
            {...control}
            value={header.difficulty}
            disabled={disabled}
            items={DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level }))}
            onChange={(value) =>
              onHeaderChange({ ...header, difficulty: value as DifficultyLevel })
            }
          />
        )}
      </Field>

      <Field htmlFor="authoring-type" label="Type">
        {(control) => (
          <Combobox
            {...control}
            value={state.type}
            disabled={disabled}
            items={QUESTION_TYPES.map((type) => ({
              value: type,
              label: QUESTION_TYPE_LABELS[type],
            }))}
            onChange={(value) => onStateChange(retyped(state, value as QuestionType))}
          />
        )}
      </Field>

      <Field
        htmlFor="authoring-tags"
        label="Tags"
        /* ui-copy-ok: rule */ hint={`Kept for every question saved from here; ${TAGS_MAX} at most`}
      >
        {(control) => (
          <MultiCombobox
            {...control}
            value={header.tags}
            disabled={disabled}
            placeholder="No tags"
            items={tagOptions.map((tag) => ({ value: tag, label: tag }))}
            onChange={(tags) => onHeaderChange({ ...header, tags: tags.slice(0, TAGS_MAX) })}
          />
        )}
      </Field>

      {typed ? (
        <Field htmlFor="authoring-answer-mode" label="Answer match">
          {(control) => (
            <Combobox
              {...control}
              value={state.answerMode}
              disabled={disabled}
              items={ANSWER_MODES.map((mode) => ({ value: mode, label: ANSWER_MODE_LABELS[mode] }))}
              onChange={(value) =>
                onStateChange({ ...state, answerMode: value as AnswerMode, tolerance: '' })
              }
            />
          )}
        </Field>
      ) : null}

      {typed && state.answerMode === ANSWER_MODE.NUMERIC ? (
        <Field
          htmlFor="authoring-tolerance"
          label="Tolerance"
          /* ui-copy-ok: rule */ hint="Counted either side of the answer; blank means none"
        >
          {(control) => (
            <Input
              {...control}
              value={state.tolerance}
              disabled={disabled}
              inputMode="decimal"
              onChange={(event) => onStateChange({ ...state, tolerance: event.target.value })}
            />
          )}
        </Field>
      ) : null}
    </div>
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
