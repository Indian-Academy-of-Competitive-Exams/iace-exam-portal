import * as React from 'react';
import { Route, Routes } from 'react-router-dom';
import { ASSIGNMENT_ROLES } from '@iace/contracts';
import { ProtectedRoute } from '@iace/app-kit/browser';
import { PageErrorBoundary } from '@iace/ui';
import { useAuth } from './providers/auth';
import { AppShell } from './components/app-shell';
import { PageSkeleton } from './components/page-skeleton';
import { LoginPage } from './routes/login';
import { NotFoundPage } from './routes/not-found';
import { ROUTES } from './lib/constants';

const DashboardPage = React.lazy(() =>
  import('./routes/dashboard').then((module) => ({ default: module.DashboardPage })),
);
const StudentsPage = React.lazy(() =>
  import('./routes/students').then((module) => ({ default: module.StudentsPage })),
);
const StudentDetailPage = React.lazy(() =>
  import('./routes/student-detail').then((module) => ({ default: module.StudentDetailPage })),
);
const StudentPerformancePage = React.lazy(() =>
  import('./routes/student-performance').then((module) => ({
    default: module.StudentPerformancePage,
  })),
);
const ImportStudentsPage = React.lazy(() =>
  import('./routes/import-students').then((module) => ({ default: module.ImportStudentsPage })),
);
const BranchesPage = React.lazy(() =>
  import('./routes/branches').then((module) => ({ default: module.BranchesPage })),
);
const ExamsPage = React.lazy(() =>
  import('./routes/exams').then((module) => ({ default: module.ExamsPage })),
);
const CohortsPage = React.lazy(() =>
  import('./routes/cohorts').then((module) => ({ default: module.CohortsPage })),
);
const QuestionsPage = React.lazy(() =>
  import('./routes/questions').then((module) => ({ default: module.QuestionsPage })),
);
const QuestionFormPage = React.lazy(() =>
  import('./routes/question-form').then((module) => ({ default: module.QuestionFormPage })),
);
const ImportQuestionsPage = React.lazy(() =>
  import('./routes/import-questions').then((module) => ({ default: module.ImportQuestionsPage })),
);
const AssignmentQueuePage = React.lazy(() =>
  import('./routes/assignment-queue').then((module) => ({
    default: module.AssignmentQueuePage,
  })),
);
const SectionProgressPage = React.lazy(() =>
  import('./routes/section-progress').then((module) => ({ default: module.SectionProgressPage })),
);
const ProofreadingSectionPage = React.lazy(() =>
  import('./routes/proofreading-section').then((module) => ({
    default: module.ProofreadingSectionPage,
  })),
);
const ProofreadingQuestionPage = React.lazy(() =>
  import('./routes/proofreading-question').then((module) => ({
    default: module.ProofreadingQuestionPage,
  })),
);
const AuthoringEditorPage = React.lazy(() =>
  import('./routes/authoring-editor').then((module) => ({ default: module.AuthoringEditorPage })),
);
const AuthoringHistoryPage = React.lazy(() =>
  import('./routes/authoring-history').then((module) => ({
    default: module.AuthoringHistoryPage,
  })),
);
const TaxonomyPage = React.lazy(() =>
  import('./routes/taxonomy').then((module) => ({ default: module.TaxonomyPage })),
);
const BaseConfigsPage = React.lazy(() =>
  import('./routes/base-configs').then((module) => ({ default: module.BaseConfigsPage })),
);
const BaseConfigFormPage = React.lazy(() =>
  import('./routes/base-config-form').then((module) => ({ default: module.BaseConfigFormPage })),
);
const TestsAndSeriesPage = React.lazy(() =>
  import('./routes/tests-and-series').then((module) => ({
    default: module.TestsAndSeriesPage,
  })),
);
const TestBuilderPage = React.lazy(() =>
  import('./routes/test-builder').then((module) => ({ default: module.TestBuilderPage })),
);
const TestPaperPage = React.lazy(() =>
  import('./routes/test-paper').then((module) => ({ default: module.TestPaperPage })),
);
const TestAnalyticsPage = React.lazy(() =>
  import('./routes/test-analytics').then((module) => ({ default: module.TestAnalyticsPage })),
);
const TestSeriesFormPage = React.lazy(() =>
  import('./routes/test-series-form').then((module) => ({ default: module.TestSeriesFormPage })),
);
const ImportEventCandidatesPage = React.lazy(() =>
  import('./routes/import-event-candidates').then((module) => ({
    default: module.ImportEventCandidatesPage,
  })),
);
const ImportProgramStudentsPage = React.lazy(() =>
  import('./routes/import-program-students').then((module) => ({
    default: module.ImportProgramStudentsPage,
  })),
);
const AdminsPage = React.lazy(() =>
  import('./routes/admins').then((module) => ({ default: module.AdminsPage })),
);
const PermissionsPage = React.lazy(() =>
  import('./routes/permissions').then((module) => ({ default: module.PermissionsPage })),
);
const AuditActivityPage = React.lazy(() =>
  import('./routes/audit').then((module) => ({ default: module.AuditActivityPage })),
);
const AuditImportsPage = React.lazy(() =>
  import('./routes/audit').then((module) => ({ default: module.AuditImportsPage })),
);
const AnnouncementsPage = React.lazy(() =>
  import('./routes/announcements').then((module) => ({ default: module.AnnouncementsPage })),
);
const LiveOpsPage = React.lazy(() =>
  import('./routes/live-ops').then((module) => ({ default: module.LiveOpsPage })),
);

/** Each chunk waits behind the same held-frame skeleton, so a route swap never shifts the layout. */
const whileLoading = (page: React.ReactNode) => (
  <PageErrorBoundary>
    <React.Suspense fallback={<PageSkeleton />}>{page}</React.Suspense>
  </PageErrorBoundary>
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
          <Route path={ROUTES.HOME} element={whileLoading(<DashboardPage />)} />
          <Route path={ROUTES.STUDENTS} element={whileLoading(<StudentsPage />)} />
          {/* Before the :id route, or "import" would be read as a student id. */}
          <Route path={ROUTES.IMPORT_STUDENTS} element={whileLoading(<ImportStudentsPage />)} />
          <Route path={ROUTES.STUDENT_PATTERN} element={whileLoading(<StudentDetailPage />)} />
          <Route
            path={ROUTES.STUDENT_PERFORMANCE_PATTERN}
            element={whileLoading(<StudentPerformancePage />)}
          />
          <Route path={ROUTES.BRANCHES} element={whileLoading(<BranchesPage />)} />
          <Route path={ROUTES.EXAMS} element={whileLoading(<ExamsPage />)} />
          <Route path={ROUTES.COHORTS} element={whileLoading(<CohortsPage />)} />
          <Route path={ROUTES.QUESTIONS} element={whileLoading(<QuestionsPage />)} />
          {/* Before the :id route, or "new", "import" and "taxonomy" would be read as a question id. */}
          <Route path={ROUTES.QUESTION_NEW} element={whileLoading(<QuestionFormPage />)} />
          <Route path={ROUTES.IMPORT_QUESTIONS} element={whileLoading(<ImportQuestionsPage />)} />
          <Route path={ROUTES.TAXONOMY} element={whileLoading(<TaxonomyPage />)} />
          <Route path={ROUTES.QUESTION_PATTERN} element={whileLoading(<QuestionFormPage />)} />
          <Route
            path={ROUTES.PROOFREADING_ASSIGNMENTS}
            element={whileLoading(<AssignmentQueuePage role={ASSIGNMENT_ROLES.PROOFREADER} />)}
          />
          <Route
            path={ROUTES.PROOFREADING_SECTION_PATTERN}
            element={whileLoading(<ProofreadingSectionPage />)}
          />
          <Route
            path={ROUTES.PROOFREADING_OF_SECTION_PATTERN}
            element={whileLoading(<ProofreadingSectionPage />)}
          />
          <Route
            path={ROUTES.PROOFREADING_QUESTION_PATTERN}
            element={whileLoading(<ProofreadingQuestionPage />)}
          />
          <Route
            path={ROUTES.PROOFREADING_SECTION_QUESTION_PATTERN}
            element={whileLoading(<ProofreadingQuestionPage />)}
          />
          <Route path={ROUTES.AUTHORING_EDITOR} element={whileLoading(<AuthoringEditorPage />)} />
          {/* Before the :id route, or "history" would be read as a question id. */}
          <Route path={ROUTES.AUTHORING_HISTORY} element={whileLoading(<AuthoringHistoryPage />)} />
          <Route
            path={ROUTES.AUTHORING_ASSIGNMENTS}
            element={whileLoading(<AssignmentQueuePage role={ASSIGNMENT_ROLES.TYPIST} />)}
          />
          {/* Before the :assignmentId route, or "import" is read as an assignment id. */}
          <Route
            path={ROUTES.AUTHORING_IMPORT_PATTERN}
            element={whileLoading(<ImportQuestionsPage />)}
          />
          <Route
            path={ROUTES.AUTHORING_FOR_ASSIGNMENT_PATTERN}
            element={whileLoading(<AuthoringEditorPage />)}
          />
          <Route
            path={ROUTES.AUTHORING_EDITOR_PATTERN}
            element={whileLoading(<AuthoringEditorPage />)}
          />
          <Route path={ROUTES.BASE_CONFIGS} element={whileLoading(<BaseConfigsPage />)} />
          {/* Before the :id route, or "new" would be read as a config id. */}
          <Route path={ROUTES.BASE_CONFIG_NEW} element={whileLoading(<BaseConfigFormPage />)} />
          <Route path={ROUTES.BASE_CONFIG_PATTERN} element={whileLoading(<BaseConfigFormPage />)} />
          {/* Before the :id route, or "new" would be read as a series id. */}
          <Route path={ROUTES.TEST_SERIES_NEW} element={whileLoading(<TestSeriesFormPage />)} />
          <Route path={ROUTES.TEST_SERIES_PATTERN} element={whileLoading(<TestSeriesFormPage />)} />

          <Route
            path={ROUTES.EVENT_IMPORT_PATTERN}
            element={whileLoading(<ImportEventCandidatesPage />)}
          />
          <Route
            path={ROUTES.PROGRAM_IMPORT_PATTERN}
            element={whileLoading(<ImportProgramStudentsPage />)}
          />
          <Route path={ROUTES.SECTION_PROGRESS} element={whileLoading(<SectionProgressPage />)} />
          <Route path={ROUTES.TESTS} element={whileLoading(<TestsAndSeriesPage />)} />
          {/* Ranked by specificity, not order: "configs", "series" and "new" outrank ":id". */}
          <Route path={ROUTES.TEST_NEW} element={whileLoading(<TestBuilderPage />)} />
          <Route path={ROUTES.TEST_PATTERN} element={whileLoading(<TestBuilderPage />)} />
          <Route path={ROUTES.TEST_PAPER_PATTERN} element={whileLoading(<TestPaperPage />)} />
          <Route
            path={ROUTES.TEST_ANALYTICS_PATTERN}
            element={whileLoading(<TestAnalyticsPage />)}
          />
          <Route path={ROUTES.LIVE_OPS} element={whileLoading(<LiveOpsPage />)} />
          {/* Super-admin screens. The route exists for everyone; the page itself refuses. */}
          <Route path={ROUTES.ADMINS} element={whileLoading(<AdminsPage />)} />
          <Route path={ROUTES.PERMISSIONS} element={whileLoading(<PermissionsPage />)} />
          <Route path={ROUTES.ANNOUNCEMENTS} element={whileLoading(<AnnouncementsPage />)} />
          <Route path={ROUTES.AUDIT} element={whileLoading(<AuditActivityPage />)} />
          <Route path={ROUTES.AUDIT_IMPORTS} element={whileLoading(<AuditImportsPage />)} />
        </Route>
      </Route>
      <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
    </Routes>
  );
}
