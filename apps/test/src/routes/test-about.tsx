import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import {
  Alert,
  Button,
  DataTable,
  LoadingState,
  PageFrame,
  PageHeader,
  StatRow,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  INSTITUTE_TIME_ZONE,
  TEST_BUCKET,
  testAction,
  testBucket,
  type ExamBrief,
  type LanguageCode,
  type PerformancePoint,
  type StudentCatalogTest,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  CATALOG_QUERY_KEY,
  LANGUAGE_LABELS,
  NAV_ITEMS,
  PERFORMANCE_QUERY_KEY,
  ROUTES,
  analyticsQueryKey,
  briefQueryKey,
} from '../lib/constants';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

type BriefSection = ExamBrief['sections'][number];

const SECTION_COLUMNS: readonly DataTableColumn<BriefSection>[] = [
  {
    key: 'name',
    header: 'Section',
    className: 'max-w-[16rem]',
    cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
  },
  { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
  { key: 'marks', header: 'Marks each', numeric: true, cell: (row) => row.marksPerQuestion },
  { key: 'negative', header: 'Negative', numeric: true, cell: (row) => row.negativeMarks },
  {
    key: 'total',
    header: 'Section marks',
    numeric: true,
    cell: (row) => round(row.questionCount * row.marksPerQuestion),
  },
];

const PAST_COLUMNS: readonly DataTableColumn<PerformancePoint>[] = [
  {
    key: 'when',
    header: 'Sat',
    cell: (row) => (row.submittedAt ? WHEN.format(new Date(row.submittedAt)) : '—'),
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'rank', header: 'Rank', numeric: true, cell: (row) => row.rank ?? '—' },
  {
    key: 'open',
    cell: (row) => (
      <Link className={linkVariants()} to={ROUTES.SCORE_CARD(row.attemptId)}>
        Score card
      </Link>
    ),
  },
];

/** What a student reads BEFORE the clock starts. Nothing here is timed and nothing here is a paper. */
export function TestAboutPage() {
  const { testId = '' } = useParams();
  const now = new Date();

  const brief = useQuery({
    queryKey: briefQueryKey(testId),
    queryFn: () => api.me.testBrief(testId),
  });
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const listed = (catalog.data?.series ?? [])
    .flatMap((series) => series.tests)
    .find((test) => test.id === testId);
  const past = (trend.data?.points ?? []).filter((point) => point.testId === testId).reverse();

  const cohortOf = useQuery({
    queryKey: analyticsQueryKey(past[0]?.attemptId ?? ''),
    queryFn: () => api.me.analytics(past[0]?.attemptId ?? ''),
    enabled: past.length > 0,
  });

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: brief.data?.title ?? 'Test', to: ROUTES.TEST_ABOUT(testId) }]}
            />
          }
          title={brief.data?.title ?? 'Test'}
          meta={
            brief.data
              ? `${plural(brief.data.totalQuestions, 'question')} · ${Math.round(brief.data.durationSec / 60)} minutes`
              : undefined
          }
          action={<Exits testId={testId} listed={listed} now={now} hasPast={past.length > 0} />}
        />
      }
    >
      {brief.isLoading ? <LoadingState /> : null}
      {brief.data ? (
        <div className="flex flex-col gap-8">
          {listed ? <Window test={listed} now={now} /> : null}

          <section className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <StatRow label="Questions" value={brief.data.totalQuestions} />
            <StatRow
              label="Duration"
              value={`${Math.round(brief.data.durationSec / 60)} minutes`}
            />
            <StatRow label="Total marks" value={totalMarksOf(brief.data)} />
            <StatRow
              label="Languages"
              value={brief.data.languages
                .map((code: LanguageCode) => LANGUAGE_LABELS[code])
                .join(', ')}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Sections</h2>
            <DataTable
              columns={SECTION_COLUMNS}
              rows={brief.data.sections}
              rowKey={(row) => row.id}
              isLoading={false}
              empty="This paper has no sections."
            />
          </section>

          {cohortOf.data ? (
            <section className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
              <h2 className="text-sm font-semibold text-foreground sm:col-span-3">Cohort</h2>
              <StatRow label="Topper" value={cohortOf.data.cohort.topperScore ?? '—'} />
              <StatRow label="Average" value={cohortOf.data.cohort.averageScore ?? '—'} />
              <StatRow label="Sat by" value={cohortOf.data.cohort.cohortSize ?? '—'} />
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Past attempts</h2>
              <DataTable
                columns={PAST_COLUMNS}
                rows={past}
                rowKey={(row) => row.attemptId}
                isLoading={false}
                empty="You have not sat this test yet."
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </PageFrame>
  );
}

function Exits({
  testId,
  listed,
  now,
  hasPast,
}: Readonly<{
  testId: string;
  listed: StudentCatalogTest | undefined;
  now: Date;
  hasPast: boolean;
}>) {
  const action = listed ? testAction(listed) : null;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {hasPast ? (
        <Button asChild variant="outline">
          <Link to={ROUTES.TESTS}>Back to your tests</Link>
        </Button>
      ) : null}
      {action ? (
        <Button asChild>
          <Link to={ROUTES.TEST_INSTRUCTIONS(testId)}>
            {action === 'RESUME' ? 'Resume test' : 'Proceed to test'}
          </Link>
        </Button>
      ) : (
        <Button disabled>{listed ? shutReason(listed, now) : 'Not open to you'}</Button>
      )}
    </span>
  );
}

/** The clock, in an Alert rather than as prose: the variant carries half of it before a word. */
function Window({ test, now }: Readonly<{ test: StudentCatalogTest; now: Date }>) {
  const bucket = testBucket(test, now);
  if (bucket === TEST_BUCKET.OPEN) return null;

  return (
    /* ui-copy-ok: consequence */
    <Alert variant={bucket === TEST_BUCKET.MISSED ? 'warning' : 'info'}>
      <span className="flex items-center gap-2">
        <CalendarClock aria-hidden />
        {whenLine(test, now)}
      </span>
    </Alert>
  );
}

function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${WHEN.format(new Date(test.opensAt))}`;
  }
  if (test.closesAt !== null) {
    const closed = Date.parse(test.closesAt) <= now.getTime();
    return `${closed ? 'Entry closed' : 'Entry closes'} ${WHEN.format(new Date(test.closesAt))}`;
  }
  return 'No fixed time — sit it whenever you are ready';
}

function shutReason(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) return 'Not open yet';
  if (test.closesAt !== null && Date.parse(test.closesAt) <= now.getTime()) return 'Entry closed';
  return 'Waiting its turn';
}

const totalMarksOf = (brief: ExamBrief) =>
  round(
    brief.sections.reduce(
      (sum, section) => sum + section.questionCount * section.marksPerQuestion,
      0,
    ),
  );

const round = (value: number) => Math.round(value * 100) / 100;
