import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Avatar,
  Button,
  EmptyState,
  LoadingState,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  TrendLine,
  type TrendPoint,
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
import { sittablesOf } from '../lib/catalog';
import { useAuth } from '../providers/auth';

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export function DashboardPage() {
  const { identity: student } = useAuth();
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });

  const now = new Date();
  const rows = sittablesOf(catalog.data?.series ?? [], now);

  const points: TrendPoint[] = (trend.data?.points ?? []).map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: point.accuracy,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));
  const last = trend.data?.points.at(-1);
  const sat = points.length > 0;

  let trendRegion;
  if (trend.isLoading) {
    trendRegion = <LoadingState />;
  } else if (sat) {
    trendRegion = (
      <>
        <MetricGroup>
          <Metric label="Tests done" value={trend.data?.testsSat ?? 0} />
          <Metric label="Last rank" value={last?.rank ?? '—'} />
          <Metric label="Last accuracy" value={last?.accuracy ?? 0} unit="%" />
        </MetricGroup>
        <section className="flex flex-col gap-3">
          <SectionHeading title="Accuracy" />
          <TrendLine points={points} unit="%" aria-label="Accuracy across your tests" />
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
          {catalog.isLoading ? (
            <Skeleton variant="row" className="h-40 rounded-lg" />
          ) : (
            <StatusStrip rows={rows} now={now} />
          )}
        </section>
      </div>
    </PageFrame>
  );
}
