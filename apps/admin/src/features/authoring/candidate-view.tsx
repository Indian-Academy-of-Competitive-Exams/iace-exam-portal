import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_TYPE,
  hasText,
  type QuestionLanguage,
} from '@iace/contracts';
import { optionalNumber } from '@iace/app-kit';
import {
  EMPTY_STATE_KINDS,
  EmptyState,
  Input,
  RadioGroup,
  RadioGroupItem,
  RichContent,
  SegmentedControl,
  StatRow,
  Textarea,
} from '@iace/ui';
import { readCandidateView } from './candidate-view-store';
import { optionLetter, type AuthoringState, type LanguageContent } from './question-scaffold';

const FRAME = 'flex h-dvh flex-col bg-background text-foreground';
const PANE = 'relative min-h-0 overflow-y-auto p-6';

/** The question as typed, drawn the way a candidate meets it: no answer, no key, nothing scored. */
export function CandidateViewPage() {
  const { viewId = '' } = useParams<{ viewId: string }>();
  const view = useMemo(() => readCandidateView(viewId), [viewId]);
  const written = useMemo(
    () => LANGUAGE_ORDER.filter((code) => view && hasText(view.state.content[code]?.stem)),
    [view],
  );
  const [chosen, setChosen] = useState<QuestionLanguage | undefined>(view?.language);

  const language = chosen && written.includes(chosen) ? chosen : written[0];
  if (!view) {
    return (
      <div className={`${FRAME} items-center justify-center p-6`}>
        <EmptyState kind={EMPTY_STATE_KINDS.FAILURE} title="Could not find this question" />
      </div>
    );
  }
  if (!language) {
    return (
      <div className={`${FRAME} items-center justify-center p-6`}>
        <EmptyState title="No question text yet" />
      </div>
    );
  }

  const content = view.state.content[language];
  const asked = <Asked content={content} language={language} state={view.state} />;

  return (
    <div className={FRAME}>
      <header className="flex min-h-12 flex-none items-center justify-between gap-3 border-b border-border bg-surface px-6">
        <h1 className="text-sm font-semibold">Question</h1>
        {written.length > 1 ? (
          <SegmentedControl
            value={language}
            onChange={(value) => setChosen(value as QuestionLanguage)}
            aria-label="Language"
            items={written.map((code) => ({
              value: code,
              label: code.toUpperCase(),
              name: LANGUAGE_LABELS[code],
            }))}
          />
        ) : null}
      </header>

      {view.state.type !== QUESTION_TYPE.TYPING && hasText(content.passage) ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
          <section
            aria-label="Passage"
            className={`${PANE} border-b border-border lg:border-b-0 lg:border-r`}
          >
            <RichContent html={content.passage} lang={language} />
          </section>
          <section aria-label="Question" className={PANE}>
            {asked}
          </section>
        </div>
      ) : (
        <main className={`${PANE} flex-1`}>
          <div className="mx-auto w-full max-w-3xl">{asked}</div>
        </main>
      )}
    </div>
  );
}

function Asked({
  content,
  language,
  state,
}: Readonly<{ content: LanguageContent; language: QuestionLanguage; state: AuthoringState }>) {
  const answeredBy = state.type;
  // A typing passage is its own question: the candidate is given a box, which is not this view's to draw.
  if (answeredBy === QUESTION_TYPE.TYPING)
    return <RichContent html={content.stem} lang={language} />;

  return (
    <div className="flex flex-col gap-4">
      <RichContent html={content.stem} lang={language} />
      {answeredBy === QUESTION_TYPE.TEXT_FIELD ? (
        <Input aria-label="Answer" className="max-w-xs" />
      ) : null}
      {answeredBy === QUESTION_TYPE.DESCRIPTIVE ? (
        <WritingBox minWords={state.minWords} maxWords={state.maxWords} />
      ) : null}
      {answeredBy === QUESTION_TYPE.SINGLE_MCQ ? (
        // Keyed by language, so a choice made in one does not stay ticked under another's text.
        <RadioGroup key={language} name="candidate-view-answer" legend="Options" hideLegend>
          {content.options.map((option, index) => (
            <RadioGroupItem
              key={optionLetter(index)}
              value={optionLetter(index)}
              label={<RichContent html={option} lang={language} />}
            />
          ))}
        </RadioGroup>
      ) : null}
    </div>
  );
}

/** The box a candidate writes in, drawn empty with the limits the question names. */
function WritingBox({ minWords, maxWords }: Readonly<{ minWords: string; maxWords: string }>) {
  const min = optionalNumber(minWords);
  const max = optionalNumber(maxWords);
  const limit = [min === null ? null : `at least ${min}`, max === null ? null : `at most ${max}`]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-3">
      <Textarea readOnly aria-label="Write your answer here" className="h-72 resize-none" />
      <div className="flex max-w-xs flex-col gap-1">
        <StatRow label="Words" value={0} />
        {limit ? <StatRow label="Limit" value={limit} /> : null}
      </div>
    </div>
  );
}
