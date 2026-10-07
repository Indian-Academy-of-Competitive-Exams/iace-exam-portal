import * as React from 'react';
import { Route, Routes } from 'react-router-dom';
import { ASSIGNMENT_ROLES } from '@iace/contracts';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { EmptyState, EMPTY_STATE_KINDS, PageErrorBoundary, PageFrame } from '@iace/ui';
import { useAuth } from './providers/auth';
import { AppShell } from './components/app-shell';
import { PageSkeleton } from './components/page-skeleton';
import { LoginPage } from './features/auth/login';
import { NotFoundPage } from './components/not-found';
import { ROUTES, opensRoute } from './lib/constants';

const DashboardPage = React.lazy(() =>
  import('./features/dashboard/dashboard').then((module) => ({ default: module.DashboardPage })),
);
const StudentsPage = React.lazy(() =>
  import('./features/students/students').then((module) => ({ default: module.StudentsPage })),
);
const StudentDetailPage = React.lazy(() =>
  import('./features/students/student-detail').then((module) => ({
    default: module.StudentDetailPage,
  })),
);
const StudentPerformancePage = React.lazy(() =>
  import('./features/students/student-performance-redirect').then((module) => ({
    default: module.StudentPerformancePage,
  })),
);
const ImportStudentsPage = React.lazy(() =>
  import('./features/imports/import-students').then((module) => ({
    default: module.ImportStudentsPage,
  })),
);
const BranchesPage = React.lazy(() =>
  import('./features/catalog/branches').then((module) => ({ default: module.BranchesPage })),
);
const ExamsPage = React.lazy(() =>
  import('./features/catalog/exams').then((module) => ({ default: module.ExamsPage })),
);
const CohortsPage = React.lazy(() =>
  import('./features/students/cohorts').then((module) => ({ default: module.CohortsPage })),
);
const QuestionsPage = React.lazy(() =>
  import('./features/questions/questions').then((module) => ({ default: module.QuestionsPage })),
);
const ImportQuestionsPage = React.lazy(() =>
  import('./features/imports/import-questions').then((module) => ({
    default: module.ImportQuestionsPage,
  })),
);
const AssignmentQueuePage = React.lazy(() =>
  import('./features/authoring/assignment-queue').then((module) => ({
    default: module.AssignmentQueuePage,
  })),
);
const SectionProgressPage = React.lazy(() =>
  import('./features/authoring/section-progress').then((module) => ({
    default: module.SectionProgressPage,
  })),
);
const BankQuestionPage = React.lazy(() =>
  import('./features/questions/bank-question').then((module) => ({
    default: module.BankQuestionPage,
  })),
);
const SectionAuthoringPage = React.lazy(() =>
  import('./features/authoring/section-authoring').then((module) => ({
    default: module.SectionAuthoringPage,
  })),
);
const AuthoringEditorPage = React.lazy(() =>
  import('./features/authoring/authoring-editor').then((module) => ({
    default: module.AuthoringEditorPage,
  })),
);
const AuthoringHistoryPage = React.lazy(() =>
  import('./features/authoring/authoring-history').then((module) => ({
    default: module.AuthoringHistoryPage,
  })),
);
const TaxonomyPage = React.lazy(() =>
  import('./features/questions/taxonomy').then((module) => ({ default: module.TaxonomyPage })),
);
const BaseConfigsPage = React.lazy(() =>
  import('./features/catalog/base-configs').then((module) => ({ default: module.BaseConfigsPage })),
);
const BaseConfigFormPage = React.lazy(() =>
  import('./features/catalog/base-config-form').then((module) => ({
    default: module.BaseConfigFormPage,
  })),
);
const TestsAndSeriesPage = React.lazy(() =>
  import('./features/tests/tests-and-series').then((module) => ({
    default: module.TestsAndSeriesPage,
  })),
);
const TestBuilderPage = React.lazy(() =>
  import('./features/tests/test-builder').then((module) => ({ default: module.TestBuilderPage })),
);
const TestPaperPage = React.lazy(() =>
  import('./features/tests/test-paper').then((module) => ({ default: module.TestPaperPage })),
);
const TestPaperPrintPage = React.lazy(() =>
  import('./features/tests/test-paper-print').then((module) => ({
    default: module.TestPaperPrintPage,
  })),
);
const TestAnalyticsPage = React.lazy(() =>
  import('./features/tests/test-analytics').then((module) => ({
    default: module.TestAnalyticsPage,
  })),
);
const TestSeriesFormPage = React.lazy(() =>
  import('./features/test-series/test-series-form').then((module) => ({
    default: module.TestSeriesFormPage,
  })),
);
const ImportEventCandidatesPage = React.lazy(() =>
  import('./features/imports/import-event-candidates').then((module) => ({
    default: module.ImportEventCandidatesPage,
  })),
);
const ImportProgramStudentsPage = React.lazy(() =>
  import('./features/imports/import-program-students').then((module) => ({
    default: module.ImportProgramStudentsPage,
  })),
);
const AdminsPage = React.lazy(() =>
  import('./features/admins/admins').then((module) => ({ default: module.AdminsPage })),
);
const PermissionsPage = React.lazy(() =>
  import('./features/admins/permissions').then((module) => ({ default: module.PermissionsPage })),
);
const AuditActivityPage = React.lazy(() =>
  import('./features/admins/audit').then((module) => ({ default: module.AuditActivityPage })),
);
const AuditImportsPage = React.lazy(() =>
  import('./features/admins/audit').then((module) => ({ default: module.AuditImportsPage })),
);
const AnnouncementsPage = React.lazy(() =>
  import('./features/announcements/announcements').then((module) => ({
    default: module.AnnouncementsPage,
  })),
);
const ReportsPage = React.lazy(() =>
  import('./features/reports/reports').then((module) => ({ default: module.ReportsPage })),
);
const ReportPage = React.lazy(() =>
  import('./features/reports/report').then((module) => ({ default: module.ReportPage })),
);
const LiveOpsPage = React.lazy(() =>
  import('./features/live-ops/live-ops').then((module) => ({ default: module.LiveOpsPage })),
);

/** Each chunk waits behind the same held-frame skeleton, so a route swap never shifts the layout. */
const whileLoading = (page: React.ReactNode) => (
  <PageErrorBoundary>
    <React.Suspense fallback={<PageSkeleton />}>{page}</React.Suspense>
  </PageErrorBoundary>
);

/** The page, or the refusal its own endpoints would answer with; not the security boundary, which is the API's guard. */
function Gated({ path, children }: Readonly<{ path: string; children: React.ReactNode }>) {
  const { can } = useAuth();

  if (opensRoute(path, can)) return <>{children}</>;
  return (
    <PageFrame>
      <EmptyState
        kind={EMPTY_STATE_KINDS.REFUSED}
        title="This screen is not open to you"
        hint="Ask a super admin for access."
      />
    </PageFrame>
  );
}

/** One address and its page, so no route can be mounted without its gate. */
const screen = (path: string, page: React.ReactNode) => (
  <Route key={path} path={path} element={whileLoading(<Gated path={path}>{page}</Gated>)} />
);

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
          {screen(ROUTES.HOME, <DashboardPage />)}
          {screen(ROUTES.STUDENTS, <StudentsPage />)}
          {/* Before the :id route, or "import" would be read as a student id. */}
          {screen(ROUTES.IMPORT_STUDENTS, <ImportStudentsPage />)}
          {screen(ROUTES.STUDENT_PATTERN, <StudentDetailPage />)}
          {screen(ROUTES.STUDENT_PERFORMANCE_PATTERN, <StudentPerformancePage />)}
          {screen(ROUTES.BRANCHES, <BranchesPage />)}
          {screen(ROUTES.EXAMS, <ExamsPage />)}
          {screen(ROUTES.COHORTS, <CohortsPage />)}
          {screen(ROUTES.QUESTIONS, <QuestionsPage />)}
          {/* Before the :id route, or "new", "import" and "taxonomy" would be read as a question id. */}
          {screen(ROUTES.QUESTION_NEW, <BankQuestionPage />)}
          {screen(ROUTES.IMPORT_QUESTIONS, <ImportQuestionsPage />)}
          {screen(ROUTES.TAXONOMY, <TaxonomyPage />)}
          {screen(ROUTES.QUESTION_PATTERN, <BankQuestionPage readOnly />)}
          {screen(ROUTES.QUESTION_EDIT_PATTERN, <BankQuestionPage />)}
          {[
            ROUTES.TYPING_SECTION_PATTERN,
            ROUTES.READING_SECTION_PATTERN,
            ROUTES.TEST_SECTION_PATTERN,
          ].map((path) => screen(path, <SectionAuthoringPage />))}
          {screen(
            ROUTES.PROOFREADING_ASSIGNMENTS,
            <AssignmentQueuePage role={ASSIGNMENT_ROLES.PROOFREADER} />,
          )}
          {screen(ROUTES.AUTHORING_EDITOR, <AuthoringEditorPage />)}
          {/* Before the :id route, or "history" would be read as a question id. */}
          {screen(ROUTES.AUTHORING_HISTORY, <AuthoringHistoryPage />)}
          {screen(
            ROUTES.AUTHORING_ASSIGNMENTS,
            <AssignmentQueuePage role={ASSIGNMENT_ROLES.TYPIST} />,
          )}
          {screen(ROUTES.AUTHORING_IMPORT_PATTERN, <ImportQuestionsPage />)}
          {screen(ROUTES.AUTHORING_EDITOR_PATTERN, <AuthoringEditorPage />)}
          {screen(ROUTES.BASE_CONFIGS, <BaseConfigsPage />)}
          {/* Before the :id route, or "new" would be read as a config id. */}
          {screen(ROUTES.BASE_CONFIG_NEW, <BaseConfigFormPage />)}
          {screen(ROUTES.BASE_CONFIG_PATTERN, <BaseConfigFormPage />)}
          {/* Before the :id route, or "new" would be read as a series id. */}
          {screen(ROUTES.TEST_SERIES_NEW, <TestSeriesFormPage />)}
          {screen(ROUTES.TEST_SERIES_PATTERN, <TestSeriesFormPage />)}

          {screen(ROUTES.EVENT_IMPORT_PATTERN, <ImportEventCandidatesPage />)}
          {screen(ROUTES.PROGRAM_IMPORT_PATTERN, <ImportProgramStudentsPage />)}
          {screen(ROUTES.SECTION_PROGRESS, <SectionProgressPage />)}
          {screen(ROUTES.TESTS, <TestsAndSeriesPage />)}
          {/* Ranked by specificity, not order: "configs", "series" and "new" outrank ":id". */}
          {screen(ROUTES.TEST_NEW, <TestBuilderPage />)}
          {screen(ROUTES.TEST_PATTERN, <TestBuilderPage />)}
          {screen(ROUTES.TEST_PAPER_PATTERN, <TestPaperPage />)}
          {screen(ROUTES.TEST_PAPER_PRINT_PATTERN, <TestPaperPrintPage />)}
          {screen(ROUTES.TEST_ANALYTICS_PATTERN, <TestAnalyticsPage />)}
          {screen(ROUTES.LIVE_OPS, <LiveOpsPage />)}
          {/* Super-admin screens. The route exists for everyone; the page itself refuses. */}
          {screen(ROUTES.ADMINS, <AdminsPage />)}
          {screen(ROUTES.PERMISSIONS, <PermissionsPage />)}
          {screen(ROUTES.ANNOUNCEMENTS, <AnnouncementsPage />)}
          {screen(ROUTES.REPORTS, <ReportsPage />)}
          {screen(ROUTES.REPORT_PATTERN, <ReportPage />)}
          {screen(ROUTES.AUDIT, <AuditActivityPage />)}
          {screen(ROUTES.AUDIT_IMPORTS, <AuditImportsPage />)}
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
    </Routes>
  );
}
