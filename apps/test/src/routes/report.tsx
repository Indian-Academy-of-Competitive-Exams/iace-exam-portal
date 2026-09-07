import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Combobox, PageFrame, PageHeader, PanelFrame } from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { REPORT_TABS, newestFirst, reportTabOf } from '@iace/app-kit';
import { INSTITUTE_TIME_ZONE, type PerformancePoint } from '@iace/contracts';
import { api } from '../lib/api';
import { NAV_ITEMS, PERFORMANCE_QUERY_KEY, PICKER_WIDTH, ROUTES } from '../lib/constants';

const UNTITLED = 'Untitled test';

/** Dense, single-body tabs stay one contained surface; the rest float their cards on the page. */
const PANEL_TABS = new Set(['solutions', 'questions']);

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
  const Frame = PANEL_TABS.has(tab) ? PanelFrame : PageFrame;

  return (
    <Frame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[
                { label: 'Performance', to: ROUTES.PERFORMANCE },
                { label: current?.testTitle ?? 'Report' },
              ]}
            />
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
      }
      tabs={{
        value: tab,
        onValueChange: (next) => navigate(ROUTES.REPORT_TAB(attemptId, next)),
        // Only the open tab's content renders, and the ROUTER is what decides what that is.
        items: REPORT_TABS.map((held) => ({
          value: held.path,
          label: held.label,
          content: <Outlet />,
        })),
      }}
    />
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
  return { points, newestFirst: newestFirst(points) };
}

const marksOf = (point: PerformancePoint) => `${point.score} of ${point.maxMarks} marks`;

/** Which sitting of the paper this was, and the day it was sat — in the institute's own zone. */
function sittingHint(point: PerformancePoint): string {
  const sat = point.submittedAt === null ? null : WHEN.format(new Date(point.submittedAt));
  return [`Attempt ${point.attemptNo}`, sat].filter((part) => part !== null).join(' · ');
}
