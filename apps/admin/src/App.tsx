import { Navigate, Route, Routes } from 'react-router-dom';
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
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
