import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import {
  Button,
  Combobox,
  PageFrame,
  PageHeader,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { REPORT_TABS, newestFirst, reportTabOf } from '@iace/app-kit';
import { INSTITUTE_TIME_ZONE, type PerformancePoint, type ScoreCard } from '@iace/contracts';
import { api } from '../lib/api';
import {
  NAV_ITEMS,
  PERFORMANCE_QUERY_KEY,
  PICKER_WIDTH,
  ROUTES,
  scoreCardQueryKey,
} from '../lib/constants';

const UNTITLED = 'Untitled test';

/** The one tab whose body is a table long enough to want the scroll for itself. */
const QUESTIONS_TAB = 'questions';

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

  return (
    <PageFrame
      // The question report is a long table: it takes the scroll so its heading and pager hold.
      fills={tab === QUESTIONS_TAB}
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
        action: <Standing attemptId={attemptId} />,
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

/** What the paper IS and what qualifies it — on the strip, so it holds on every tab. */
function Standing({ attemptId }: Readonly<{ attemptId: string }>) {
  const card = useQuery({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });
  const notices = card.data ? noticesFor(card.data) : [];
  return notices.length === 0 ? null : <Notices notices={notices} />;
}

function Notices({ notices }: Readonly<{ notices: readonly string[] }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon">
          <Info aria-hidden />
          <span className="sr-only">About this result</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <span className="flex flex-col gap-2">
          {notices.map((notice) => (
            <span key={notice}>{notice}</span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Each one is a CONSEQUENCE the figures cannot show: what can still move it, and what it misses. */
function noticesFor(card: ScoreCard): string[] {
  const notices: string[] = [];
  if (!card.isGraded) {
    notices.push('This was a retake, so it is marked but it does not carry a rank.');
  }
  return notices;
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
