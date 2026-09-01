import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, PanelTopOpen, X } from 'lucide-react';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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

  const tab = reportTabOf(pathname, ROUTES.REPORT(attemptId));
  const [showTabs, setShowTabs] = useState(true);

  return (
    <PageFrame
      header={
        <div className="flex flex-col gap-4">
          <PageHeader
            breadcrumbs={
              <PageCrumbs nav={NAV_ITEMS} tail={[{ label: current?.testTitle ?? 'Report' }]} />
            }
            title="Report"
            meta={current === null ? undefined : marksOf(current)}
            action={
              <Combobox
                value={attemptId}
                onChange={(next) => navigate(ROUTES.REPORT_TAB(next, tab))}
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
          {showTabs ? (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-4 pt-4">
              <Tabs
                value={tab}
                onValueChange={(next) => navigate(ROUTES.REPORT_TAB(attemptId, next))}
                className="min-w-0 flex-1"
              >
                <TabsList className="-mx-4 px-4">
                  {REPORT_TABS.map((held) => (
                    <TabsTrigger key={held.path} value={held.path}>
                      {held.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mt-2 shrink-0"
                    onClick={() => setShowTabs(false)}
                  >
                    <X aria-hidden />
                    <span className="sr-only">Hide the tabs</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Hide the tabs</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <Button variant="outline" className="self-start" onClick={() => setShowTabs(true)}>
              <PanelTopOpen aria-hidden />
              {REPORT_TABS.find((held) => held.path === tab)?.label ?? 'Score card'}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6 pt-6">
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
