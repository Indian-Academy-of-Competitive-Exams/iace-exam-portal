import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { useAuth } from './providers/auth';
import { ROUTES } from './lib/constants';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { AppShell } from './components/app-shell';
import { AccountPage } from './routes/account';
import { ProfilePage } from './routes/profile';
import { BrowsePage } from './routes/browse';
import { TestsPage } from './routes/tests';
import { SeriesPage } from './routes/series';
import { TestAboutPage } from './routes/test-about';
import { TestInstructionsPage } from './routes/test-instructions';
import { ExamPage } from './routes/exam';
import { SubmittedPage } from './routes/submitted';
import { ScoreCardPage } from './routes/score-card';
import { ReviewPage } from './routes/review';
import { PerformancePage } from './routes/performance';
import { LeaderboardPage } from './routes/leaderboard';

/** Phase 0 routing: a login screen and one authed shell. */
export function App() {
  const { identity, isLoading } = useAuth();

  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
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
          <Route path={ROUTES.HOME} element={<DashboardPage />} />
          <Route path={ROUTES.TESTS} element={<TestsPage />} />
          <Route path={ROUTES.PERFORMANCE} element={<PerformancePage />} />
          <Route path={ROUTES.LEADERBOARD} element={<LeaderboardPage />} />
          <Route path={ROUTES.BROWSE} element={<BrowsePage />} />
          <Route path={ROUTES.SERIES_PATTERN} element={<SeriesPage />} />
          <Route path={ROUTES.TEST_ABOUT_PATTERN} element={<TestAboutPage />} />
          <Route path={ROUTES.TEST_INSTRUCTIONS_PATTERN} element={<TestInstructionsPage />} />
          <Route path={ROUTES.SUBMITTED_PATTERN} element={<SubmittedPage />} />
          <Route path={ROUTES.SCORE_CARD_PATTERN} element={<ScoreCardPage />} />
          <Route path={ROUTES.REVIEW_PATTERN} element={<ReviewPage />} />
          <Route path={ROUTES.PROFILE} element={<ProfilePage />} />
          <Route path={ROUTES.ACCOUNT} element={<AccountPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
