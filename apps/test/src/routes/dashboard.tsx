import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Button, PageHeader, StatRow, TrendLine, type TrendPoint } from '@iace/ui';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { api } from '../lib/api';
import { PERFORMANCE_QUERY_KEY, PROFILE_QUERY_KEY, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export function DashboardPage() {
  const { identity: student } = useAuth();
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const points: TrendPoint[] = (trend.data?.points ?? []).map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: point.accuracy,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));
  const last = trend.data?.points.at(-1);

  return (
    <>
      <PageHeader
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
          <Button asChild variant="outline">
            <Link to={ROUTES.PERFORMANCE}>See your performance</Link>
          </Button>
        }
      />

      <PreTestPrompt preTestReady={student?.preTestReady ?? true} />

      {points.length > 0 ? (
        <section className="mt-6 flex flex-col gap-3">
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
            <StatRow label="Tests done" value={trend.data?.testsSat ?? 0} />
            <StatRow label="Last rank" value={last?.rank ?? '—'} />
            <StatRow label="Last accuracy" value={`${last?.accuracy ?? 0}%`} />
          </div>
          <TrendLine points={points} unit="%" aria-label="Accuracy across your tests" />
        </section>
      ) : null}
    </>
  );
}
