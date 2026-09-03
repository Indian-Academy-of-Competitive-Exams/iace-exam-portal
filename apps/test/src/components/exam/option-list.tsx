import {
  ANSWER_STATE,
  contentLanguageOf,
  LANGUAGE_MODE,
  omrFillFor,
  TEST_UI,
  type ExamQuestion,
  type LanguageCode,
  type LanguageMode,
  type TestUi,
} from '@iace/contracts';
import { FillBubble, RichContent, cn } from '@iace/ui';
import { LANGUAGE_LABELS } from '../../lib/constants';
import { htmlOf, shownLanguages } from './content';

/** The answers on offer. One radio group per question, lettered the way a paper letters them. */

export function OptionList({
  question,
  languages,
  languageMode,
  selectedOptionId,
  marked,
  testUi,
  onSelect,
  onBubble,
}: Readonly<{
  question: ExamQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  selectedOptionId: string | null;
  marked: boolean;
  testUi: TestUi;
  onSelect: (optionId: string) => void;
  onBubble: (optionId: string, fill: number) => void;
}>) {
  const shown = shownLanguages(languages, languageMode);
  const bubbling = testUi === TEST_UI.OMR;
  // Committed: an option is held and the question is not flagged, so the ink is dry.
  const locked = bubbling && selectedOptionId !== null && !marked;
  // What the held option's ink says: flagged is half filled, unflagged is committed.
  const heldFill = omrFillFor(marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED);
  const fillOf = (optionId: string) => (optionId === selectedOptionId ? heldFill : 0);

  return (
    <>
      <ol className="flex flex-col gap-2">
        {question.options.map((option, position) => (
          <li key={option.id}>
            <label
              className={cn(
                'flex items-start gap-3 rounded-exam-option border p-3 transition-colors',
                locked ? 'cursor-default' : 'cursor-pointer',
                option.id === selectedOptionId
                  ? 'border-exam-option-selected-border bg-exam-option-selected'
                  : 'border-exam-option-border bg-exam-option hover:bg-exam-surface-2',
              )}
            >
              {bubbling ? (
                <FillBubble
                  className="mt-0.5"
                  label={String.fromCodePoint(65 + position)}
                  fill={fillOf(option.id)}
                  disabled={locked}
                  onFillChange={(fill) => onBubble(option.id, fill)}
                />
              ) : (
                <input
                  type="radio"
                  name={`q-${question.questionId}`}
                  className="mt-0.5 size-4 shrink-0 accent-[--exam-option-selected-border]"
                  checked={option.id === selectedOptionId}
                  onChange={() => onSelect(option.id)}
                />
              )}
              <span className="w-5 shrink-0 text-sm font-medium text-exam-ink-muted">
                {String.fromCodePoint(65 + position)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {shown.map((language) => (
                  <RichContent
                    key={language}
                    lang={language.toLowerCase()}
                    className="text-sm leading-relaxed text-exam-ink"
                    html={htmlOf(option.text[contentLanguageOf(language)])}
                  />
                ))}
              </span>
            </label>
          </li>
        ))}
      </ol>

      {languageMode !== LANGUAGE_MODE.DUAL && languages.length > 1 && shown[0] ? (
        <p className="text-xs text-exam-ink-muted">{`Shown in ${LANGUAGE_LABELS[shown[0]]}`}</p>
      ) : null}
    </>
  );
}
