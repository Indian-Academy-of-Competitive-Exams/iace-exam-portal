import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import {
  Alert,
  Button,
  DataTable,
  Metric,
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
  LANGUAGE_MODE,
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
  briefQueryKey,
} from '../lib/constants';
import {
  BandSkeleton,
  BlockPairSkeleton,
  PageBody,
  Section,
  StatBand,
  SurfaceCard,
} from '../components/ui';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const PAST_COLUMNS: readonly DataTableColumn<PerformancePoint>[] = [
  {
    key: 'when',
    header: 'Sat',
    cell: (row) => (row.submittedAt ? WHEN.format(new Date(row.submittedAt)) : '—'),
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'rank', header: 'Rank', numeric: true, cell: (row) => row.rank ?? '—' },
  { key: 'percentile', header: 'Percentile', numeric: true, cell: (row) => row.percentile ?? '—' },
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

  const series = catalog.data?.series.find((row) => row.tests.some((test) => test.id === testId));
  const listed = series?.tests.find((test) => test.id === testId);
  const past = (trend.data?.points ?? []).filter((point) => point.testId === testId).reverse();

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
          size="display"
          title={brief.data?.title ?? 'Test'}
          meta={series?.name}
          action={listed ? <Window test={listed} /> : undefined}
        />
      }
    >
      <PageBody>
        {brief.isLoading ? (
          <>
            <BandSkeleton />
            <BlockPairSkeleton />
          </>
        ) : null}

        {brief.data ? (
          <>
            {listed ? <Shut test={listed} now={now} /> : null}

            <StatBand>
              <Metric label="Questions" value={brief.data.totalQuestions} size="sm" />
              <Metric
                label="Duration (minutes)"
                value={Math.round(brief.data.durationSec / 60)}
                size="sm"
              />
              <Metric label="Total marks" value={totalMarksOf(brief.data)} size="sm" />
              <Metric label="Negative" value={negativeOf(brief.data)} size="sm" />
            </StatBand>

            <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
              <SurfaceCard title="Sections" meta={plural(brief.data.sections.length, 'section')}>
                <DataTable
                  columns={SECTION_COLUMNS}
                  rows={brief.data.sections}
                  rowKey={(row) => row.id}
                  isLoading={brief.isLoading}
                  empty="This paper has no sections."
                />
              </SurfaceCard>

              <SurfaceCard title="The paper">
                <div className="flex flex-col gap-2">
                  <StatRow label="Languages" value={languagesOf(brief.data)} />
                  <StatRow label="Sectional timing" value={sectionalOf(brief.data)} />
                  {listed?.sittingCount === null || listed === undefined ? null : (
                    <StatRow label="Sat by" value={listed.sittingCount} />
                  )}
                </div>
              </SurfaceCard>
            </div>

            <Exits testId={testId} listed={listed} now={now} hasPast={past.length > 0} />

            {past.length > 0 ? (
              <Section title="Past attempts" meta={plural(past.length, 'attempt')}>
                <DataTable
                  columns={PAST_COLUMNS}
                  rows={past}
                  rowKey={(row) => row.attemptId}
                  isLoading={trend.isLoading}
                  empty="You have not sat this test yet."
                />
              </Section>
            ) : null}
          </>
        ) : null}
      </PageBody>
    </PageFrame>
  );
}

const SECTION_COLUMNS: readonly DataTableColumn<ExamBrief['sections'][number]>[] = [
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

/** A time is prose, not a figure: set at a headline size it shouts over the title beside it. */
function Window({ test }: Readonly<{ test: StudentCatalogTest }>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Opens
      </span>
      <span className="text-md font-semibold text-foreground">
        {test.opensAt === null ? 'Any time' : WHEN.format(new Date(test.opensAt))}
      </span>
      {test.closesAt === null ? null : (
        <span className="text-sm text-muted-foreground">
          {`Entry closes ${WHEN.format(new Date(test.closesAt))}`}
        </span>
      )}
    </div>
  );
}

/** A shut window is a consequence, so it is an Alert — the variant carries half of it. */
function Shut({ test, now }: Readonly<{ test: StudentCatalogTest; now: Date }>) {
  const bucket = testBucket(test, now);
  if (bucket === TEST_BUCKET.OPEN || bucket === TEST_BUCKET.DONE) return null;

  return (
    /* ui-copy-ok: consequence */
    <Alert variant={bucket === TEST_BUCKET.MISSED ? 'warning' : 'info'}>
      <span className="flex items-center gap-2">
        <CalendarClock aria-hidden />
        {bucket === TEST_BUCKET.MISSED
          ? 'Entry has closed for this paper; your past attempts stay here.'
          : 'This paper has not opened yet. Nothing can be started until it does.'}
      </span>
    </Alert>
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
    <div className="flex flex-wrap items-center gap-3">
      {action ? (
        <Button asChild>
          <Link to={ROUTES.TEST_INSTRUCTIONS(testId)}>
            {action === 'RESUME' ? 'Resume test' : 'Proceed to test'}
          </Link>
        </Button>
      ) : (
        <Button disabled>{listed ? shutReason(listed, now) : 'Not open to you'}</Button>
      )}
      {hasPast ? (
        <Button asChild variant="outline">
          <Link to={ROUTES.TESTS}>Back to your tests</Link>
        </Button>
      ) : null}
    </div>
  );
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

/** One figure where every section agrees, and a range where they do not — never a wrong single one. */
function negativeOf(brief: ExamBrief): string {
  const values = [...new Set(brief.sections.map((section) => section.negativeMarks))].sort(
    (a, b) => a - b,
  );
  if (values.length === 0) return '—';
  if (values.length === 1) return `−${values[0]}`;
  return `−${values[0]} to −${values.at(-1)}`;
}

const languagesOf = (brief: ExamBrief) => {
  const named = brief.languages.map((code: LanguageCode) => LANGUAGE_LABELS[code]).join(', ');
  return brief.languageMode === LANGUAGE_MODE.DUAL ? `${named} (side by side)` : named;
};

const sectionalOf = (brief: ExamBrief) =>
  brief.sections.some((section) => section.durationSec !== null) ? 'Yes' : 'No';

const round = (value: number) => Math.round(value * 100) / 100;
