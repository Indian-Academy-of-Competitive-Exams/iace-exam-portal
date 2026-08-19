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
import { ExamTypesPage } from './routes/exam-types';
import { ImportGroupMembersPage } from './routes/import-group-members';
import { QuestionsPage } from './routes/questions';
import { QuestionFormPage } from './routes/question-form';
import { ImportQuestionsPage } from './routes/import-questions';
import { TaxonomyPage } from './routes/taxonomy';
import { AdminsPage } from './routes/admins';
import { FeaturesPage } from './routes/features';
import { PermissionsPage } from './routes/permissions';
import { AuditPage } from './routes/audit';
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
          <Route path={ROUTES.EXAM_TYPES} element={<ExamTypesPage />} />
          <Route path={ROUTES.IMPORT_GROUP_MEMBERS_PATTERN} element={<ImportGroupMembersPage />} />
          <Route path={ROUTES.QUESTIONS} element={<QuestionsPage />} />
          {/* Before the :id route, or "new", "import" and "taxonomy" would each
              be read as a question id. */}
          <Route path={ROUTES.QUESTION_NEW} element={<QuestionFormPage />} />
          <Route path={ROUTES.IMPORT_QUESTIONS} element={<ImportQuestionsPage />} />
          <Route path={ROUTES.TAXONOMY} element={<TaxonomyPage />} />
          <Route path={ROUTES.QUESTION_PATTERN} element={<QuestionFormPage />} />
          {/* Super-admin screens. The route exists for everyone — the page
              itself refuses, so a pasted URL gets a sentence rather than a
              redirect that looks like a broken link. */}
          <Route path={ROUTES.ADMINS} element={<AdminsPage />} />
          <Route path={ROUTES.FEATURES} element={<FeaturesPage />} />
          <Route path={ROUTES.PERMISSIONS} element={<PermissionsPage />} />
          <Route path={ROUTES.AUDIT} element={<AuditPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
