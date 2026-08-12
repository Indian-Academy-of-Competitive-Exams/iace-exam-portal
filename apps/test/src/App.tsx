import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from './lib/constants';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { AppShell } from './components/app-shell';
import { AccountPage } from './routes/account';
import { ProfilePage } from './routes/profile';
import { ProfileViewPage } from './routes/profile-view';
import { ProtectedRoute } from './routes/protected-route';

/**
 * Phase 0 routing: a login screen and one authed shell. The real map (Report
 * dashboard as the landing page, Tests, Bookmarks, Documents, Announcements)
 * arrives with the features themselves.
 */
export function App() {
  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path={ROUTES.HOME} element={<DashboardPage />} />
          <Route path={ROUTES.PROFILE} element={<ProfileViewPage />} />
          <Route path={ROUTES.PROFILE_EDIT} element={<ProfilePage />} />
          <Route path={ROUTES.ACCOUNT} element={<AccountPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
