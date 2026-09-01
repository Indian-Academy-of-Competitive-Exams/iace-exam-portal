import { useMemo } from 'react';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  PICK_REFUSAL,
  QUESTION_STATUS,
  pickIssue,
  type BaseConfigSection,
  type DifficultyLevel,
  type PickRefusal,
  type QuestionSummary,
  type SectionDrawSpec,
  type SectionQuota,
} from '@iace/contracts';
import { useLocalFilters, useScrollList } from '@iace/app-kit/browser';
import { Plus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ListView,
  TruncatedText,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { QuestionLink } from './question-viewer';

/** The pool one section draws from, as its own configuration describes it, chosen from by hand. */

/** A screenful at a time: the rest arrives as the reader scrolls, so nothing pages under them. */
const POOL_PAGE_SIZE = 25;

const DIFFICULTY_VARIANT: Readonly<
  Record<QuestionSummary['difficulty'], 'success' | 'warning' | 'danger'>
> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

/** Said where the Add button would have been, so a row explains itself rather than greying out. */
function refusalText(refusal: PickRefusal, level: DifficultyLevel): string {
  return refusal === PICK_REFUSAL.QUOTA_MET
    ? `${DIFFICULTY_LABELS[level]} is full`
    : 'Section is full';
}

function questionColumns(
  options: Readonly<{
    onAdd: ((question: QuestionSummary) => void) | undefined;
    held: ReadonlySet<string>;
    quota: SectionQuota;
    questionCount: number;
  }>,
): DataTableColumn<QuestionSummary>[] {
  const { onAdd, held, quota, questionCount } = options;
  const add: DataTableColumn<QuestionSummary>[] = onAdd
    ? [
        {
          key: 'add',
          className: 'text-right',
          cell: (question) => {
            if (held.has(question.id)) {
              return <span className="text-xs text-muted-foreground">On the paper</span>;
            }
            const refusal = pickIssue(question.difficulty, quota, questionCount);
            return refusal ? (
              <span className="text-xs text-muted-foreground">
                {refusalText(refusal, question.difficulty)}
              </span>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => onAdd(question)}>
                <Plus aria-hidden />
                Add
              </Button>
            );
          },
        },
      ]
    : [];

  return [...baseColumns(), ...add];
}

/** Two columns, not six: this list lives in half a screen and a row read across is unread. */
function baseColumns(): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'question',
      header: 'Question',
      // `w-full max-w-0` is what lets a cell take the rest of the row AND still cut its text.
      className: 'w-full max-w-0',
      cell: (question) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <QuestionLink questionId={question.id}>
            <TruncatedText>{question.stemPreview}</TruncatedText>
          </QuestionLink>
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
            <TruncatedText className="text-xs text-muted-foreground">
              {[question.questionCode, question.topic?.name].filter(Boolean).join(' · ') || null}
            </TruncatedText>
          </span>
        </span>
      ),
    },
  ];
}

/** One toggle per difficulty, each carrying how far that bucket has been filled. */
function DifficultyChips({
  value,
  onChange,
  quota,
  ...naming
}: Readonly<ListFilterMultiControl & { quota: SectionQuota }>) {
  const chosen = new Set(value);

  return (
    <div {...naming} className="flex flex-wrap items-center gap-2">
      {DIFFICULTY_LEVELS.map((level) => {
        const { chosen: taken, allowed } = quota[level];
        const on = chosen.has(level);
        return (
          <Button
            key={level}
            type="button"
            size="sm"
            variant={on ? 'secondary' : 'outline'}
            aria-pressed={on}
            onClick={() =>
              onChange(on ? value.filter((held) => held !== level) : [...value, level])
            }
          >
            {DIFFICULTY_LABELS[level]}
            {allowed === null ? null : (
              <Badge
                variant={taken >= allowed ? 'success' : 'neutral'}
              >{`${taken}/${allowed}`}</Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}

export function QuestionChooser({
  section,
  spec,
  quota,
  held,
  onAdd,
  disabled,
}: Readonly<{
  section: BaseConfigSection;
  /** What the section draws from. The pool follows it, so narrowing the topics narrows this. */
  spec: SectionDrawSpec;
  quota: SectionQuota;
  /** What the paper already holds, so a question on it is not offered twice. */
  held: ReadonlySet<string>;
  onAdd: (question: QuestionSummary) => void;
  disabled?: boolean;
}>) {
  const store = useLocalFilters();
  const taken = DIFFICULTY_LEVELS.reduce((sum, level) => sum + quota[level].chosen, 0);
  const full = taken >= section.questionCount;

  const columns = useMemo(
    () =>
      questionColumns({
        onAdd: disabled || full ? undefined : onAdd,
        held,
        quota,
        questionCount: section.questionCount,
      }),
    [disabled, full, onAdd, held, quota, section.questionCount],
  );

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search questions',
      placeholder: 'Search the text, a code or a tag',
      primary: true,
    },
    {
      key: 'difficulty',
      kind: 'customMulti',
      label: 'Difficulty',
      primary: true,
      width: 'w-auto',
      render: (control: ListFilterMultiControl) => <DifficultyChips {...control} quota={quota} />,
    },
  ] as const;

  const questions = useScrollList({
    queryKey: [...QUERY_KEYS.QUESTIONS, QUERY_SCOPES.PICKER, section.id],
    filters: filterSpec,
    store,
    toQuery: (values) => ({
      q: values.q || undefined,
      difficulty: values.difficulty as DifficultyLevel[],
      status: [QUESTION_STATUS.ACTIVE],
      subjectId: section.subjectId ? [section.subjectId] : undefined,
      topicId: spec.topicIds,
    }),
    fetchPage: (params) => api.admin.questions.list({ ...params, pageSize: POOL_PAGE_SIZE }),
  });

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold tracking-tight text-foreground">
        The bank
        {questions.hasLoaded ? (
          <span className="text-xs font-normal text-muted-foreground">
            {plural(questions.total, 'question')}
          </span>
        ) : null}
      </h3>

      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        empty="The bank holds no live question for this section yet."
        emptyFiltered="No question matches those filters."
      />

      {full && !disabled ? (
        <Alert variant="info">{`${section.name} is full. Take one off to put another on.`}</Alert>
      ) : null}
    </section>
  );
}
