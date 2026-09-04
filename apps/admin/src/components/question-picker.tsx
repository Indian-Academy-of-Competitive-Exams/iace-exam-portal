import { useMemo, type ReactNode } from 'react';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  PICK_REFUSAL,
  QUESTION_STATUS,
  boundedPicks,
  pickIssue,
  quotaWithPicks,
  type BaseConfigSection,
  type DifficultyLevel,
  type OfferedQuestion,
  type PickRefusal,
  type QuestionSummary,
  type SectionDrawSpec,
  type SectionQuota,
} from '@iace/contracts';
import { useLocalFilters, useScrollList } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  ListView,
  SectionHeading,
  TruncatedText,
  plural,
  type DataTableColumn,
  type DataTableSelection,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { QuestionLink } from './question-viewer';

/** The pool one section draws from, as its own configuration describes it, chosen from by hand. */

/** A screenful at a time: the rest arrives as the reader scrolls, so nothing pages under them. */
const POOL_PAGE_SIZE = 25;

/** What is ticked, by question, carrying the difficulty a filter change would otherwise hide. */
export type QuestionPicks = ReadonlyMap<string, DifficultyLevel>;

export interface QuestionPicking {
  picked: QuestionPicks;
  /** Already bound to what the section can still take — the caller only has to send it. */
  onPicked: (next: QuestionPicks) => void;
  /** Beside the heading — what sends the ticked questions, and what it says it will send. */
  action?: ReactNode;
}

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
    : 'No room left';
}

function questionColumns(
  options: Readonly<{
    picking: QuestionPicking | undefined;
    held: ReadonlySet<string>;
    quota: SectionQuota;
    questionCount: number;
  }>,
): DataTableColumn<QuestionSummary>[] {
  const { picking, held, quota, questionCount } = options;
  if (!picking) return baseColumns();

  const pick: DataTableColumn<QuestionSummary> = {
    key: 'pick',
    className: 'whitespace-nowrap text-right',
    cell: (question) => {
      if (held.has(question.id)) {
        return <span className="text-xs text-muted-foreground">On the paper</span>;
      }
      const refusal = pickIssue(question.difficulty, quota, questionCount);
      return refusal ? (
        <span className="text-xs text-muted-foreground">
          {refusalText(refusal, question.difficulty)}
        </span>
      ) : null;
    },
  };

  return [...baseColumns(), pick];
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
  picking,
  disabled,
}: Readonly<{
  section: BaseConfigSection;
  /** What the section draws from. The pool follows it, so narrowing the topics narrows this. */
  spec: SectionDrawSpec;
  quota: SectionQuota;
  /** What the paper already holds, so a question on it is not offered twice. */
  held: ReadonlySet<string>;
  /** Rows are ticked and sent to the paper in one batch instead of one at a time. */
  picking?: QuestionPicking;
  disabled?: boolean;
}>) {
  const store = useLocalFilters();
  const taken = DIFFICULTY_LEVELS.reduce((sum, level) => sum + quota[level].chosen, 0);
  const full = taken >= section.questionCount;
  const picks = useMemo(() => [...(picking?.picked.values() ?? [])], [picking?.picked]);
  const live = useMemo(() => quotaWithPicks(quota, picks), [quota, picks]);

  const columns = useMemo(
    () => questionColumns({ picking, held, quota: live, questionCount: section.questionCount }),
    [picking, held, live, section.questionCount],
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
      render: (control: ListFilterMultiControl) => <DifficultyChips {...control} quota={live} />,
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

  // Ticks first, so a tick-all fills what is left around them instead of pushing them out.
  const offered: OfferedQuestion[] = [
    ...[...(picking?.picked ?? [])].map(([questionId, difficulty]) => ({ questionId, difficulty })),
    ...questions.rows.map((row) => ({ questionId: row.id, difficulty: row.difficulty })),
  ];

  const canTake = (id: string): boolean => {
    const level = offered.find((row) => row.questionId === id)?.difficulty;
    return (
      level !== undefined && !held.has(id) && pickIssue(level, live, section.questionCount) === null
    );
  };

  const selection: DataTableSelection | undefined =
    picking && !disabled && !full
      ? {
          selected: new Set(picking.picked.keys()),
          label: `Select what ${section.name} can still take`,
          selectable: canTake,
          onChange: (next) =>
            picking.onPicked(boundedPicks(offered, next, held, quota, section.questionCount)),
        }
      : undefined;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <SectionHeading
        className="shrink-0"
        title="The bank"
        meta={questions.hasLoaded ? plural(questions.total, 'question') : null}
        action={picking?.action}
      />

      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        selection={selection}
        empty="The bank holds no live question for this section yet."
        emptyFiltered="No question matches those filters."
      />

      {full && !disabled ? (
        <Alert variant="info" className="shrink-0">
          {`${section.name} is full. Take one off to put another on.`}
        </Alert>
      ) : null}
    </section>
  );
}
