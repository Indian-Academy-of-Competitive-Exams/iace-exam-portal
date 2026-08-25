import { useMemo } from 'react';
import { DIFFICULTY_LEVELS, QUESTION_STATUS, type QuestionSummary } from '@iace/contracts';
import { useListScreen, useLocalFilters } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  ListView,
  TruncatedText,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { TopicMultiPicker } from './taxonomy-picker';

/** Choosing questions for one section: the bank, filtered the way its own screen filters it. */

const DIFFICULTY_VARIANT: Readonly<
  Record<QuestionSummary['difficulty'], 'success' | 'warning' | 'danger'>
> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

function questionColumns(): DataTableColumn<QuestionSummary>[] {
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
      cell: (question) => <TruncatedText>{question.stemPreview}</TruncatedText>,
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
  chosen,
  onChosen,
  needed,
  disabled,
}: Readonly<{
  /** The section's own subject: the draw uses it, so the chooser must not offer past it. */
  subjectId: string | null;
  chosen: readonly string[];
  onChosen: (next: string[]) => void;
  /** How many the section holds, so the count can say what is still owed. */
  needed: number;
  disabled?: boolean;
}>) {
  const store = useLocalFilters();
  const columns = useMemo(() => questionColumns(), []);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search questions',
      placeholder: 'Search the question text or a code',
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

  const picked = questions.rows.filter((question) => chosen.includes(question.id));

  return (
    <div className="flex flex-col gap-3">
      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        selection={
          disabled
            ? undefined
            : {
                selected: new Set(chosen),
                onChange: (next) => onChosen([...next]),
                label: 'Choose this question',
              }
        }
        empty="The bank holds no live question for this section yet."
        emptyFiltered="No question matches those filters."
      />

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3">
        <span className="text-sm font-medium text-foreground">
          {`${chosen.length} of ${plural(needed, 'question')} chosen by hand`}
        </span>
        <span className="text-sm text-muted-foreground">the draw fills the rest</span>
      </div>

      {picked.length > 0 ? (
        <BadgeList
          items={picked}
          max={6}
          label={(question) => question.questionCode ?? question.stemPreview}
        />
      ) : null}
    </div>
  );
}
