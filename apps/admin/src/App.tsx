import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from './lib/constants';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { ProtectedRoute } from './routes/protected-route';

/**
 * Phase 0 routing: a login screen and one authed shell. Question bank, test
 * builder, students and reports mount here as their features land, each behind
 * the `Page.code` its screen requires.
 */
export function App() {
  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path={ROUTES.HOME} element={<DashboardPage />} />
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
