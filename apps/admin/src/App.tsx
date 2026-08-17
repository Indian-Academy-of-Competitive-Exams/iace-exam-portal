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
import { AdminsPage } from './routes/admins';
import { FeaturesPage } from './routes/features';
import { PermissionsPage } from './routes/permissions';
import { ROUTES } from './lib/constants';

/** ProtectedRoute is the outer gate; AppShell is the layout inside it. */
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
          {/* Super-admin screens. The route exists for everyone — the page
              itself refuses, so a pasted URL gets a sentence rather than a
              redirect that looks like a broken link. */}
          <Route path={ROUTES.ADMINS} element={<AdminsPage />} />
          <Route path={ROUTES.FEATURES} element={<FeaturesPage />} />
          <Route path={ROUTES.PERMISSIONS} element={<PermissionsPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
