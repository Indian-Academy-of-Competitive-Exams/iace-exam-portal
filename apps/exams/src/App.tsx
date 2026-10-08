import * as React from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { LoadingState, PageErrorBoundary } from '@iace/ui';
import { useAuth } from './providers/auth';
import { ROUTES } from './lib/constants';
import { LoginPage } from './features/auth/login';
import { NotFoundPage } from './not-found';
import { AppShell } from './components/app-shell';
import { PageSkeleton, ReportSkeleton } from './components/ui';

/** DEV only, and lazy so the standing paper never reaches a student's payload. */
const RailwayPreviewPage = React.lazy(() =>
  import('./features/exam/railway-preview').then((module) => ({
    default: module.RailwayPreviewPage,
  })),
);

/** Every screen behind login is lazy, so the first paint pays for login and the shell alone. */
const DashboardPage = React.lazy(() =>
  import('./features/dashboard/dashboard').then((module) => ({ default: module.DashboardPage })),
);
const OverviewPage = React.lazy(() =>
  import('./features/performance/overview').then((module) => ({ default: module.OverviewPage })),
);
const ScoreCardPanel = React.lazy(() =>
  import('./features/performance/score-card').then((module) => ({
    default: module.ScoreCardPanel,
  })),
);
const SubjectPanel = React.lazy(() =>
  import('./features/performance/subject-report').then((module) => ({
    default: module.SubjectPanel,
  })),
);
const ComparePanel = React.lazy(() =>
  import('./features/performance/compare').then((module) => ({ default: module.ComparePanel })),
);
const ExamPage = React.lazy(() =>
  import('./features/exam/exam').then((module) => ({ default: module.ExamPage })),
);
const SolutionPanel = React.lazy(() =>
  import('./features/review/review').then((module) => ({ default: module.SolutionPanel })),
);
const DownloadsPage = React.lazy(() =>
  import('./features/downloads/downloads').then((module) => ({ default: module.DownloadsPage })),
);
const SavedPage = React.lazy(() =>
  import('./features/review/saved').then((module) => ({ default: module.SavedPage })),
);
const AccountPage = React.lazy(() =>
  import('./features/account/account').then((module) => ({ default: module.AccountPage })),
);
const ProfilePage = React.lazy(() =>
  import('./features/account/profile').then((module) => ({ default: module.ProfilePage })),
);
const TestsPage = React.lazy(() =>
  import('./features/tests/tests').then((module) => ({ default: module.TestsPage })),
);
const SeriesPage = React.lazy(() =>
  import('./features/tests/series').then((module) => ({ default: module.SeriesPage })),
);
const TestAboutPage = React.lazy(() =>
  import('./features/tests/test-about').then((module) => ({ default: module.TestAboutPage })),
);
const TestInstructionsPage = React.lazy(() =>
  import('./features/exam/test-instructions').then((module) => ({
    default: module.TestInstructionsPage,
  })),
);
const SubmittedPage = React.lazy(() =>
  import('./features/exam/submitted').then((module) => ({ default: module.SubmittedPage })),
);
const QuestionReportPanel = React.lazy(() =>
  import('./features/performance/question-report').then((module) => ({
    default: module.QuestionReportPanel,
  })),
);
const ReportShell = React.lazy(() =>
  import('./features/performance/report').then((module) => ({ default: module.ReportShell })),
);
const ReportRedirect = React.lazy(() =>
  import('./features/performance/report').then((module) => ({ default: module.ReportRedirect })),
);
const LeaderboardPage = React.lazy(() =>
  import('./features/leaderboard/leaderboard').then((module) => ({
    default: module.LeaderboardPage,
  })),
);
const NotificationsPage = React.lazy(() =>
  import('./features/notifications/notifications').then((module) => ({
    default: module.NotificationsPage,
  })),
);
const NotificationSettingsPage = React.lazy(() =>
  import('./features/notifications/notification-settings').then((module) => ({
    default: module.NotificationSettingsPage,
  })),
);

/** Each chunk waits on the shape it is about to become, never on one spinner standing in for all of them. */
const whileLoading = (page: React.ReactNode, fallback: React.ReactNode) => (
  <PageErrorBoundary>
    <React.Suspense fallback={fallback}>{page}</React.Suspense>
  </PageErrorBoundary>
);

/** Phase 0 routing: a login screen and one authed shell. */
export function App() {
  const { identity, isLoading, isUnreachable, retry } = useAuth();

  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      {import.meta.env.DEV ? (
        <Route
          path="/railway-preview"
          element={whileLoading(
            <RailwayPreviewPage />,
            <LoadingState>Opening your paper</LoadingState>,
          )}
        />
      ) : null}
      <Route
        element={
          <ProtectedRoute
            isAuthenticated={identity !== null}
            isLoading={isLoading}
            isUnreachable={isUnreachable}
            onRetry={retry}
            loginPath={ROUTES.LOGIN}
          />
        }
      >
        <Route
          path={ROUTES.TEST_INSTRUCTIONS_PATTERN}
          element={whileLoading(
            <TestInstructionsPage />,
            <LoadingState>Opening your instructions</LoadingState>,
          )}
        />
        <Route
          path={ROUTES.EXAM_PATTERN}
          element={whileLoading(<ExamPage />, <LoadingState>Opening your paper</LoadingState>)}
        />
        <Route element={<AppShell />}>
          <Route path={ROUTES.HOME} element={whileLoading(<DashboardPage />, <PageSkeleton />)} />
          <Route path={ROUTES.TESTS} element={whileLoading(<TestsPage />, <PageSkeleton />)} />
          <Route
            path={ROUTES.PERFORMANCE}
            element={whileLoading(<OverviewPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.LEADERBOARD}
            element={whileLoading(<LeaderboardPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.NOTIFICATIONS}
            element={whileLoading(<NotificationsPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.NOTIFICATION_SETTINGS}
            element={whileLoading(<NotificationSettingsPage />, <PageSkeleton />)}
          />
          <Route path={ROUTES.SAVED} element={whileLoading(<SavedPage />, <PageSkeleton />)} />
          <Route
            path={ROUTES.DOWNLOADS}
            element={whileLoading(<DownloadsPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.SERIES_PATTERN}
            element={whileLoading(<SeriesPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.TEST_ABOUT_PATTERN}
            element={whileLoading(<TestAboutPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.SUBMITTED_PATTERN}
            element={whileLoading(<SubmittedPage />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.REPORT_PATTERN}
            element={whileLoading(<ReportShell />, <ReportSkeleton />)}
          >
            <Route index element={whileLoading(<ScoreCardPanel />, <ReportSkeleton />)} />
            <Route path="subjects" element={whileLoading(<SubjectPanel />, <ReportSkeleton />)} />
            <Route path="solutions" element={whileLoading(<SolutionPanel />, <ReportSkeleton />)} />
            <Route
              path="questions"
              element={whileLoading(<QuestionReportPanel />, <ReportSkeleton />)}
            />
            <Route path="compare" element={whileLoading(<ComparePanel />, <ReportSkeleton />)} />
          </Route>
          <Route
            path={ROUTES.SCORE_CARD_PATTERN}
            element={whileLoading(<ReportRedirect tab="" />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.REVIEW_PATTERN}
            element={whileLoading(<ReportRedirect tab="solutions" />, <PageSkeleton />)}
          />
          <Route
            path={ROUTES.QUESTION_REPORT_PATTERN}
            element={whileLoading(<ReportRedirect tab="questions" />, <PageSkeleton />)}
          />
          <Route path={ROUTES.PROFILE} element={whileLoading(<ProfilePage />, <PageSkeleton />)} />
          <Route path={ROUTES.ACCOUNT} element={whileLoading(<AccountPage />, <PageSkeleton />)} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
    </Routes>
  );
}
