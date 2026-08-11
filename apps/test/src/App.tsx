import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { ProtectedRoute } from './routes/protected-route';

/**
 * Phase 0 routing: a login screen and one authed shell. The real map (Report
 * dashboard as the landing page, Tests, Bookmarks, Documents, Announcements)
 * arrives with the features themselves.
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
