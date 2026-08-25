import { useMemo } from 'react';
import { DIFFICULTY_LEVELS, QUESTION_STATUS, type QuestionSummary } from '@iace/contracts';
import { useListScreen, useLocalFilters } from '@iace/app-kit/browser';
import { Plus } from 'lucide-react';
import {
  Badge,
  BadgeList,
  Button,
  ListView,
  TruncatedText,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { TopicMultiPicker } from './taxonomy-picker';
import { QuestionLink } from './question-viewer';

/** Choosing questions for one section: the bank, filtered the way its own screen filters it. */

const DIFFICULTY_VARIANT: Readonly<
  Record<QuestionSummary['difficulty'], 'success' | 'warning' | 'danger'>
> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

function questionColumns(
  onAdd: ((question: QuestionSummary) => void) | undefined,
  held: ReadonlySet<string>,
): DataTableColumn<QuestionSummary>[] {
  const add: DataTableColumn<QuestionSummary>[] = onAdd
    ? [
        {
          key: 'add',
          className: 'text-right',
          cell: (question) =>
            held.has(question.id) ? (
              <span className="text-xs text-muted-foreground">On the paper</span>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => onAdd(question)}>
                <Plus aria-hidden />
                Add
              </Button>
            ),
        },
      ]
    : [];

  return [...baseColumns(), ...add];
}

function baseColumns(): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'code',
      header: 'Code',
      className: 'max-w-[10rem] font-mono text-sm',
      cell: (question) => <TruncatedText>{question.questionCode}</TruncatedText>,
    },
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-[24rem] font-medium',
      cell: (question) => (
        <QuestionLink questionId={question.id}>
          <TruncatedText>{question.stemPreview}</TruncatedText>
        </QuestionLink>
      ),
    },
    {
      key: 'topic',
      header: 'Topic',
      className: 'max-w-[12rem] text-muted-foreground',
      cell: (question) => <TruncatedText>{question.topic?.name ?? null}</TruncatedText>,
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (question) => (
        <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      className: 'max-w-[10rem]',
      cell: (question) => <BadgeList items={question.tags} label={(tag) => tag} />,
    },
  ];
}

/** The bank for one section, ticked. Inline: a section is already open, so nothing needs opening. */
export function QuestionChooser({
  subjectId,
  held,
  onAdd,
  disabled,
}: Readonly<{
  /** The section's own subject: the draw uses it, so the chooser must not offer past it. */
  subjectId: string | null;
  /** What the paper already holds, so a question on it is not offered twice. */
  held: ReadonlySet<string>;
  onAdd: (question: QuestionSummary) => void;
  disabled?: boolean;
}>) {
  const store = useLocalFilters();
  const columns = useMemo(
    () => questionColumns(disabled ? undefined : onAdd, held),
    [disabled, onAdd, held],
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
      key: 'topicId',
      kind: 'customMulti',
      label: 'Topic',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <TopicMultiPicker {...control} subjectIds={subjectId ? [subjectId] : []} />
      ),
    },
    {
      key: 'difficulty',
      kind: 'multi',
      label: 'Difficulty',
      placeholder: 'Any difficulty',
      items: DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
    },
  ] as const;

  const questions = useListScreen({
    queryKey: ['admin', 'questions', 'picker', subjectId ?? ''],
    filters: filterSpec,
    store,
    toQuery: (values) => ({
      q: values.q || undefined,
      topicId: values.topicId,
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      status: [QUESTION_STATUS.ACTIVE],
      subjectId: subjectId ? [subjectId] : undefined,
    }),
    fetchPage: (params) => api.admin.questions.list(params),
  });

  return (
    <ListView
      list={questions}
      filters={filterSpec}
      columns={columns}
      rowKey={(question) => question.id}
      empty="The bank holds no live question for this section yet."
      emptyFiltered="No question matches those filters."
    />
  );
}
