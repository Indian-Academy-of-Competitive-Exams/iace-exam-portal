import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Button,
  Combobox,
  EmptyState,
  LoadingState,
  PageFrame,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { REPORT_TABS, latestSitting, newestFirst, reportTabOf } from '@iace/app-kit';
import { INSTITUTE_TIME_ZONE, type PerformancePoint } from '@iace/contracts';
import { api } from '../lib/api';
import { NAV_ITEMS, PERFORMANCE_QUERY_KEY, PICKER_WIDTH, ROUTES } from '../lib/constants';

const UNTITLED = 'Untitled test';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

/** One sitting, whole. The tabs are routes, so a tab is a place a student can be sent. */
export function ReportShell() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sat = useSittings();

  const current = sat.points.find((point) => point.attemptId === attemptId) ?? null;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs nav={NAV_ITEMS} tail={[{ label: current?.testTitle ?? 'Report' }]} />
          }
          title="Report"
          meta={current === null ? undefined : marksOf(current)}
          action={
            <Combobox
              value={attemptId}
              onChange={(next) =>
                navigate(ROUTES.REPORT_TAB(next, reportTabOf(pathname, ROUTES.REPORT(attemptId))))
              }
              items={sat.newestFirst.map((point) => ({
                value: point.attemptId,
                label: point.testTitle ?? UNTITLED,
                hint: sittingHint(point),
              }))}
              clearable={false}
              aria-label="Test"
              className={PICKER_WIDTH.REPORT}
            />
          }
        />
      }
    >
      <div className="flex min-h-0 flex-col gap-6">
        <Tabs
          value={reportTabOf(pathname, ROUTES.REPORT(attemptId))}
          onValueChange={(tab) => navigate(ROUTES.REPORT_TAB(attemptId, tab))}
        >
          <TabsList>
            {REPORT_TABS.map((tab) => (
              <TabsTrigger key={tab.path} value={tab.path}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Outlet />
      </div>
    </PageFrame>
  );
}

/** The Performance nav opens on the last test they sat, the way the report itself is read. */
export function LatestReportPage() {
  const sat = useSittings();
  const latest = latestSitting(sat.points);

  if (sat.isLoading) return <LoadingState />;
  if (latest) return <Navigate to={ROUTES.REPORT(latest.attemptId)} replace />;

  return (
    <PageFrame header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Report" />}>
      <EmptyState
        icon={ClipboardList}
        title="No marked tests yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    </PageFrame>
  );
}

/** A link written before the shell existed still lands on the tab it was always asking for. */
export function ReportRedirect({ tab }: Readonly<{ tab: string }>) {
  const { attemptId = '' } = useParams();
  return <Navigate to={ROUTES.REPORT_TAB(attemptId, tab)} replace />;
}

/** The trend is oldest-first, which is the line a chart draws and the reverse of a picker's list. */
function useSittings() {
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const points = trend.data?.points ?? [];
  return { points, newestFirst: newestFirst(points), isLoading: trend.isLoading };
}

const marksOf = (point: PerformancePoint) => `${point.score} of ${point.maxMarks} marks`;

/** Which sitting of the paper this was, and the day it was sat — in the institute's own zone. */
function sittingHint(point: PerformancePoint): string {
  const sat = point.submittedAt === null ? null : WHEN.format(new Date(point.submittedAt));
  return [`Attempt ${point.attemptNo}`, sat].filter((part) => part !== null).join(' · ');
}
