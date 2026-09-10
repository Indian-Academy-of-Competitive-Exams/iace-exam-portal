import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DIFFICULTY_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  INSTITUTE_TIME_ZONE,
  todayISO,
  type AuthoringStats,
  type QuestionLanguage,
  type QuestionStatus,
  type QuestionSummary,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ChartFigure,
  LinePlot,
  ListView,
  Metric,
  MetricGroup,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  DIFFICULTY_VARIANT,
  NAV_ITEMS,
  QUERY_KEYS,
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_VARIANT,
  QUESTION_TYPE_LABELS,
  ROUTES,
} from '../lib/constants';
import { SubjectMultiPicker } from '../components/taxonomy-picker';

function historyColumns(): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-md',
      cell: (question) => (
        <div>
          <Link to={ROUTES.AUTHORING_QUESTION(question.id)} className={linkVariants()}>
            <TruncatedText>{question.stemPreview}</TruncatedText>
          </Link>
          {question.questionCode ? (
            <TruncatedText className="text-xs text-muted-foreground">
              {question.questionCode}
            </TruncatedText>
          ) : null}
        </div>
      ),
    },
    {
      key: 'taxonomy',
      header: 'Filed under',
      className: 'max-w-56',
      cell: (question) => (
        <TruncatedText className="text-muted-foreground">
          {[question.subject.name, question.topic?.name].filter(Boolean).join(' / ')}
        </TruncatedText>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (question) => (
        <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      className: 'max-w-40',
      cell: (question) => <TruncatedText>{QUESTION_TYPE_LABELS[question.type]}</TruncatedText>,
    },
    {
      key: 'languages',
      header: 'Languages',
      cell: (question) => <LanguageBadges present={question.languages} />,
    },
    {
      key: 'status',
      header: 'State',
      cell: (question) => (
        <Badge variant={QUESTION_STATUS_VARIANT[question.status]}>
          {QUESTION_STATUS_LABELS[question.status]}
        </Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last updated',
      className: 'max-w-40',
      cell: (question) => (
        <TruncatedText className="text-muted-foreground">
          {UPDATED_FORMATTER.format(new Date(question.updatedAt))}
        </TruncatedText>
      ),
    },
  ];
}

/** Every language, so a question missing Telugu says so rather than simply not mentioning it. */
function LanguageBadges({ present }: Readonly<{ present: readonly QuestionLanguage[] }>) {
  return (
    <span className="flex gap-1">
      {LANGUAGE_ORDER.map((language) => (
        <Badge key={language} variant={present.includes(language) ? 'success' : 'neutral'}>
          {LANGUAGE_LABELS[language].slice(0, 2).toUpperCase()}
        </Badge>
      ))}
    </span>
  );
}

export function AuthoringHistoryPage() {
  const stats = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'stats'],
    queryFn: () => api.admin.authoring.stats(),
  });

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search your questions',
      placeholder: 'Search the text, a code or a tag',
      primary: true,
    },
    {
      key: 'status',
      kind: 'multi',
      label: 'State',
      placeholder: 'Any state',
      primary: true,
      items: QUESTION_STATUSES.map((status) => ({
        value: status,
        label: QUESTION_STATUS_LABELS[status],
      })),
    },
    {
      key: 'subjectId',
      kind: 'customMulti',
      label: 'Subject',
      render: (control: ListFilterMultiControl) => <SubjectMultiPicker {...control} />,
    },
    {
      key: 'difficulty',
      kind: 'multi',
      label: 'Difficulty',
      placeholder: 'Any difficulty',
      items: DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
    },
    {
      key: 'type',
      kind: 'multi',
      label: 'Type',
      placeholder: 'Any type',
      items: QUESTION_TYPES.map((type) => ({ value: type, label: QUESTION_TYPE_LABELS[type] })),
    },
    { key: 'from', kind: 'date', label: 'Written from', max: todayISO() },
    { key: 'to', kind: 'date', label: 'Written to', max: todayISO() },
  ] as const;

  const questions = useListScreen({
    queryKey: [...QUERY_KEYS.AUTHORING, 'history'],
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      status: values.status as QuestionStatus[],
      subjectId: values.subjectId,
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      type: values.type as QuestionSummary['type'][],
      from: values.from || undefined,
      to: values.to || undefined,
    }),
    fetchPage: (params) => api.admin.authoring.history(params),
  });

  const columns = useMemo(() => historyColumns(), []);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="History"
      meta={stats.data ? `${stats.data.total} written` : undefined}
    />
  );

  return (
    <TableFrame header={header}>
      <Output stats={stats.data} />

      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        empty="You have not written a question yet"
        emptyFiltered="None of your questions match those filters"
      />
    </TableFrame>
  );
}

/** The author's own pace. Blue-led, because a chart in this app is never brand red. */
function Output({ stats }: Readonly<{ stats: AuthoringStats | undefined }>) {
  if (!stats) return null;

  const points = stats.daily.map((day) => ({
    key: day.date,
    label: dayLabel(day.date),
    value: day.count,
  }));

  return (
    <div className="mb-4 space-y-4">
      <MetricGroup>
        <Metric label="Today" value={String(stats.today)} />
        <Metric label="Last 7 days" value={String(stats.lastSevenDays)} />
        <Metric label="Written" value={String(stats.total)} />
        <Metric label="In review" value={String(stats.inReview)} />
      </MetricGroup>

      <ChartFigure title="Questions written" meta={`${stats.daily.length} days`}>
        <LinePlot
          points={points}
          min={0}
          height={CHART_HEIGHT}
          xLabels
          aria-label="Questions written per day"
        />
      </ChartFigure>
    </div>
  );
}

const CHART_HEIGHT = 180;

const UPDATED_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Day and month only: thirty ticks along an axis have no room for a year nobody is reading. */
function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}
