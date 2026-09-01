import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  LoadingState,
  LinePlot,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  type LinePoint,
} from '@iace/ui';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { StatusStrip } from '../components/tests/status-strip';
import { api } from '../lib/api';
import {
  CATALOG_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  PROFILE_QUERY_KEY,
  ROUTES,
} from '../lib/constants';
import { averagePercentile, bestRank, sittablesOf, type Sittable } from '../lib/catalog';
import { useAuth } from '../providers/auth';

/** viewBox units against the wide box a full-width plot uses, not pixels. */
const TREND_HEIGHT = 140;

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export function DashboardPage() {
  const { identity: student } = useAuth();
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });

  const now = new Date();
  const rows = sittablesOf(catalog.data?.series ?? [], now);

  const sittings = trend.data?.points ?? [];
  const points: LinePoint[] = sittings.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: point.percentile,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));
  const sat = points.length > 0;

  let trendRegion;
  if (trend.isLoading) {
    trendRegion = <LoadingState />;
  } else if (trend.isError) {
    trendRegion = <Alert variant="danger">Your performance did not load.</Alert>;
  } else if (sat) {
    trendRegion = (
      <>
        <MetricGroup>
          <Metric label="Average percentile" value={averagePercentile(sittings)} />
          <Metric label="Best rank" value={bestRank(sittings)} />
          <Metric label="Tests done" value={trend.data?.testsSat ?? 0} />
        </MetricGroup>
        <section className="flex flex-col gap-3">
          <SectionHeading title="Percentile" />
          <LinePlot
            compact
            points={points}
            height={TREND_HEIGHT}
            aria-label="Percentile across your tests"
          />
        </section>
      </>
    );
  } else {
    trendRegion = (
      <EmptyState
        icon={ClipboardList}
        title="No tests sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PageFrame
      header={
        <PageHeader
          size="display"
          leading={
            <Avatar
              src={me.data?.profile?.photoUrl}
              name={student?.fullName}
              fallback={student?.mobile}
              size="lg"
            />
          }
          title={student?.fullName ? `Welcome, ${student.fullName}` : 'Welcome'}
          meta={<span className="tabular-nums">+91 {student?.mobile}</span>}
          action={
            trend.isLoading || sat ? (
              <Button asChild variant="outline">
                <Link to={ROUTES.PERFORMANCE}>See your performance</Link>
              </Button>
            ) : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-8">
        <PreTestPrompt preTestReady={student?.preTestReady ?? true} />

        {trendRegion}

        <section className="flex flex-col gap-3">
          <SectionHeading title="Next" />
          <NextRegion catalog={catalog} rows={rows} now={now} />
        </section>
      </div>
    </PageFrame>
  );
}

/** The catalog's own load state, distinct from a genuinely empty one — an error is not "nothing". */
function NextRegion({
  catalog,
  rows,
  now,
}: Readonly<{
  catalog: { isLoading: boolean; isError: boolean };
  rows: readonly Sittable[];
  now: Date;
}>) {
  if (catalog.isLoading) {
    return <Skeleton variant="row" className="h-40 rounded-lg" />;
  }
  if (catalog.isError) {
    return <Alert variant="danger">Your tests did not load.</Alert>;
  }
  return <StatusStrip rows={rows} now={now} />;
}
