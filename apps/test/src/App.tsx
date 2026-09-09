import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { useAuth } from './providers/auth';
import { ROUTES } from './lib/constants';
import { LoginPage } from './routes/login';
import { AppShell } from './components/app-shell';
import { AccountPage } from './routes/account';
import { ProfilePage } from './routes/profile';
import { TestsPage } from './routes/tests';
import { SeriesPage } from './routes/series';
import { TestAboutPage } from './routes/test-about';
import { TestInstructionsPage } from './routes/test-instructions';
import { ExamPage } from './routes/exam';
import { SubmittedPage } from './routes/submitted';
import { SolutionPanel } from './routes/review';
import { QuestionReportPanel } from './routes/question-report';
import { ReportRedirect, ReportShell } from './routes/report';
import { LeaderboardPage } from './routes/leaderboard';
import { NotificationsPage } from './routes/notifications';
import { NotificationSettingsPage } from './routes/notification-settings';
import { PageSkeleton, ReportSkeleton } from './components/ui';

/** Every screen that draws charts, so the plotting library stays off the first payload. */
const DashboardPage = React.lazy(() =>
  import('./routes/dashboard').then((module) => ({ default: module.DashboardPage })),
);
const OverviewPage = React.lazy(() =>
  import('./routes/overview').then((module) => ({ default: module.OverviewPage })),
);
const ScoreCardPanel = React.lazy(() =>
  import('./routes/score-card').then((module) => ({ default: module.ScoreCardPanel })),
);
const SubjectPanel = React.lazy(() =>
  import('./routes/subject-report').then((module) => ({ default: module.SubjectPanel })),
);
const ComparePanel = React.lazy(() =>
  import('./routes/compare').then((module) => ({ default: module.ComparePanel })),
);
const SharedReportPage = React.lazy(() =>
  import('./routes/shared-report').then((module) => ({ default: module.SharedReportPage })),
);

/** Each chunk waits on the shape it is about to become, never on one spinner standing in for all six. */
const whileLoading = (page: React.ReactNode, fallback: React.ReactNode) => (
  <React.Suspense fallback={fallback}>{page}</React.Suspense>
);

/** Phase 0 routing: a login screen and one authed shell. */
export function App() {
  const { identity, isLoading } = useAuth();

  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      {/* Outside the guard on purpose: a shared report is read by somebody with no account. */}
      <Route
        path={ROUTES.SHARED_REPORT_PATTERN}
        element={whileLoading(<SharedReportPage />, <ReportSkeleton />)}
      />
      <Route
        element={
          <ProtectedRoute
            isAuthenticated={identity !== null}
            isLoading={isLoading}
            loginPath={ROUTES.LOGIN}
          />
        }
      >
        <Route path={ROUTES.EXAM_PATTERN} element={<ExamPage />} />
        <Route element={<AppShell />}>
          <Route path={ROUTES.HOME} element={whileLoading(<DashboardPage />, <PageSkeleton />)} />
          <Route path={ROUTES.TESTS} element={<TestsPage />} />
          <Route
            path={ROUTES.PERFORMANCE}
            element={whileLoading(<OverviewPage />, <PageSkeleton />)}
          />
          <Route path={ROUTES.LEADERBOARD} element={<LeaderboardPage />} />
          <Route path={ROUTES.NOTIFICATIONS} element={<NotificationsPage />} />
          <Route path={ROUTES.NOTIFICATION_SETTINGS} element={<NotificationSettingsPage />} />
          <Route path={ROUTES.SERIES_PATTERN} element={<SeriesPage />} />
          <Route path={ROUTES.TEST_ABOUT_PATTERN} element={<TestAboutPage />} />
          <Route path={ROUTES.TEST_INSTRUCTIONS_PATTERN} element={<TestInstructionsPage />} />
          <Route path={ROUTES.SUBMITTED_PATTERN} element={<SubmittedPage />} />
          <Route path={ROUTES.REPORT_PATTERN} element={<ReportShell />}>
            <Route index element={whileLoading(<ScoreCardPanel />, <ReportSkeleton />)} />
            <Route path="subjects" element={whileLoading(<SubjectPanel />, <ReportSkeleton />)} />
            <Route path="solutions" element={<SolutionPanel />} />
            <Route path="questions" element={<QuestionReportPanel />} />
            <Route path="compare" element={whileLoading(<ComparePanel />, <ReportSkeleton />)} />
          </Route>
          <Route path={ROUTES.SCORE_CARD_PATTERN} element={<ReportRedirect tab="" />} />
          <Route path={ROUTES.REVIEW_PATTERN} element={<ReportRedirect tab="solutions" />} />
          <Route
            path={ROUTES.QUESTION_REPORT_PATTERN}
            element={<ReportRedirect tab="questions" />}
          />
          <Route path={ROUTES.PROFILE} element={<ProfilePage />} />
          <Route path={ROUTES.ACCOUNT} element={<AccountPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
