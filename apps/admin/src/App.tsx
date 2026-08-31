import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { useAuth } from './providers/auth';
import { AppShell } from './components/app-shell';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/dashboard';
import { StudentsPage } from './routes/students';
import { StudentDetailPage } from './routes/student-detail';
import { AccessRequestsPage } from './routes/access-requests';
import { ImportScholarshipPage } from './routes/import-scholarship';
import { ImportStudentsPage } from './routes/import-students';
import { BranchesPage } from './routes/branches';
import { BranchTestsPage } from './routes/branch-tests';
import { ExamsPage } from './routes/exams';
import { ProgramsPage } from './routes/programs';
import { QuestionsPage } from './routes/questions';
import { QuestionFormPage } from './routes/question-form';
import { QuestionApprovalsPage } from './routes/question-approvals';
import { ImportQuestionsPage } from './routes/import-questions';
import { TaxonomyPage } from './routes/taxonomy';
import { BaseConfigsPage } from './routes/base-configs';
import { BaseConfigFormPage } from './routes/base-config-form';
import { TestsPage } from './routes/tests';
import { TestBuilderPage } from './routes/test-builder';
import { TestSeriesPage } from './routes/test-series';
import { TestSeriesFormPage } from './routes/test-series-form';
import { AdminsPage } from './routes/admins';
import { PermissionsPage } from './routes/permissions';
import { AuditActivityPage, AuditImportsPage } from './routes/audit';
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
          <Route path={ROUTES.BRANCHES} element={<BranchesPage />} />
          <Route path={ROUTES.BRANCH_TESTS_PATTERN} element={<BranchTestsPage />} />
          <Route path={ROUTES.EXAMS} element={<ExamsPage />} />
          <Route path={ROUTES.PROGRAMS} element={<ProgramsPage />} />
          <Route path={ROUTES.QUESTIONS} element={<QuestionsPage />} />
          {/* Before the :id route, or "new", "import" and "taxonomy" would each
              be read as a question id. */}
          <Route path={ROUTES.QUESTION_NEW} element={<QuestionFormPage />} />
          <Route path={ROUTES.QUESTION_APPROVALS} element={<QuestionApprovalsPage />} />
          <Route path={ROUTES.IMPORT_QUESTIONS} element={<ImportQuestionsPage />} />
          <Route path={ROUTES.TAXONOMY} element={<TaxonomyPage />} />
          <Route path={ROUTES.QUESTION_PATTERN} element={<QuestionFormPage />} />
          <Route path={ROUTES.BASE_CONFIGS} element={<BaseConfigsPage />} />
          {/* Before the :id route, or "new" would be read as a config id. */}
          <Route path={ROUTES.BASE_CONFIG_NEW} element={<BaseConfigFormPage />} />
          <Route path={ROUTES.BASE_CONFIG_PATTERN} element={<BaseConfigFormPage />} />
          <Route path={ROUTES.TEST_SERIES} element={<TestSeriesPage />} />
          {/* Before the :id route, or "new" would be read as a series id. */}
          <Route path={ROUTES.TEST_SERIES_NEW} element={<TestSeriesFormPage />} />
          <Route path={ROUTES.ACCESS_REQUESTS} element={<AccessRequestsPage />} />
          <Route path={ROUTES.TEST_SERIES_PATTERN} element={<TestSeriesFormPage />} />
          <Route path={ROUTES.SERIES_CANDIDATES_PATTERN} element={<ImportScholarshipPage />} />
          <Route path={ROUTES.TESTS} element={<TestsPage />} />
          {/* Last of the /tests routes: "configs", "series" and "new" all outrank ":id". */}
          <Route path={ROUTES.TEST_NEW} element={<TestBuilderPage />} />
          <Route path={ROUTES.TEST_PATTERN} element={<TestBuilderPage />} />
          {/* Super-admin screens. The route exists for everyone — the page
              itself refuses, so a pasted URL gets a sentence rather than a
              redirect that looks like a broken link. */}
          <Route path={ROUTES.ADMINS} element={<AdminsPage />} />
          <Route path={ROUTES.PERMISSIONS} element={<PermissionsPage />} />
          <Route path={ROUTES.AUDIT} element={<AuditActivityPage />} />
          <Route path={ROUTES.AUDIT_IMPORTS} element={<AuditImportsPage />} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<Navigate to={ROUTES.HOME} replace />} />
    </Routes>
  );
}
