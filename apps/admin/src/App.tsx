import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { useAuth } from './providers/auth';
import { AppShell } from './components/app-shell';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { StudentsPage } from './routes/students';
import { StudentDetailPage } from './routes/student-detail';
import { GroupsPage } from './routes/groups';
import { ImportStudentsPage } from './routes/import-students';
import { BranchesPage } from './routes/branches';
import { ImportGroupMembersPage } from './routes/import-group-members';
import { ROUTES } from './lib/constants';

/**
 * Everything authed renders inside AppShell, so the header and nav are defined
 * once. ProtectedRoute is the outer gate; the shell is the layout inside it.
 */
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
        <Route element={<AppShell />}>
          <Route path={ROUTES.HOME} element={<DashboardPage />} />
          <Route path={ROUTES.STUDENTS} element={<StudentsPage />} />
          {/* Before the :id route, or "import" would be read as a student id. */}
          <Route path={ROUTES.IMPORT_STUDENTS} element={<ImportStudentsPage />} />
          <Route path={ROUTES.STUDENT_PATTERN} element={<StudentDetailPage />} />
          <Route path={ROUTES.GROUPS} element={<GroupsPage />} />
          <Route path={ROUTES.BRANCHES} element={<BranchesPage />} />
          <Route path={ROUTES.IMPORT_GROUP_MEMBERS_PATTERN} element={<ImportGroupMembersPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
