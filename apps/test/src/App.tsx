import * as React from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { LoadingState } from '@iace/ui';
import { useAuth } from './providers/auth';
import { ROUTES } from './lib/constants';
import { LoginPage } from './routes/login';
import { NotFoundPage } from './routes/not-found';
import { AppShell } from './components/app-shell';
import { AccountPage } from './routes/account';
import { ProfilePage } from './routes/profile';
import { TestsPage } from './routes/tests';
import { SeriesPage } from './routes/series';
import { TestAboutPage } from './routes/test-about';
import { TestInstructionsPage } from './routes/test-instructions';
import { SubmittedPage } from './routes/submitted';
import { QuestionReportPanel } from './routes/question-report';
import { ReportRedirect, ReportShell } from './routes/report';
import { LeaderboardPage } from './routes/leaderboard';
import { NotificationsPage } from './routes/notifications';
import { NotificationSettingsPage } from './routes/notification-settings';
import { PageSkeleton, ReportSkeleton } from './components/ui';

/** DEV only, and lazy so the standing paper never reaches a student's payload. */
const RailwayPreviewPage = React.lazy(() =>
  import('./routes/railway-preview').then((module) => ({ default: module.RailwayPreviewPage })),
);

/** Every screen that draws charts or equations, so the plotting and maths libraries stay off the first payload. */
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
const ExamPage = React.lazy(() =>
  import('./routes/exam').then((module) => ({ default: module.ExamPage })),
);
const SolutionPanel = React.lazy(() =>
  import('./routes/review').then((module) => ({ default: module.SolutionPanel })),
);
const SavedPage = React.lazy(() =>
  import('./routes/saved').then((module) => ({ default: module.SavedPage })),
);

/** Each chunk waits on the shape it is about to become, never on one spinner standing in for all of them. */
const whileLoading = (page: React.ReactNode, fallback: React.ReactNode) => (
  <React.Suspense fallback={fallback}>{page}</React.Suspense>
);

/** Phase 0 routing: a login screen and one authed shell. */
export function App() {
  const { identity, isLoading } = useAuth();

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
            loginPath={ROUTES.LOGIN}
          />
        }
      >
        <Route path={ROUTES.TEST_INSTRUCTIONS_PATTERN} element={<TestInstructionsPage />} />
        <Route
          path={ROUTES.EXAM_PATTERN}
          element={whileLoading(<ExamPage />, <LoadingState>Opening your paper</LoadingState>)}
        />
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
          <Route path={ROUTES.SAVED} element={whileLoading(<SavedPage />, <PageSkeleton />)} />
          <Route path={ROUTES.SERIES_PATTERN} element={<SeriesPage />} />
          <Route path={ROUTES.TEST_ABOUT_PATTERN} element={<TestAboutPage />} />
          <Route path={ROUTES.SUBMITTED_PATTERN} element={<SubmittedPage />} />
          <Route path={ROUTES.REPORT_PATTERN} element={<ReportShell />}>
            <Route index element={whileLoading(<ScoreCardPanel />, <ReportSkeleton />)} />
            <Route path="subjects" element={whileLoading(<SubjectPanel />, <ReportSkeleton />)} />
            <Route path="solutions" element={whileLoading(<SolutionPanel />, <ReportSkeleton />)} />
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
      <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
    </Routes>
  );
}
