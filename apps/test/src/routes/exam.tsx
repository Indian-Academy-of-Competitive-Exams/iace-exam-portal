/**
 * The exam hall. It starts the sitting, hands the engine the paper and lets the
 * chosen template draw it — the screen itself decides nothing about how a
 * sitting behaves, and a skin decides nothing about what it saves.
 */
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type ExamPaper, type LanguageCode } from '@iace/contracts';
import { Alert, LoadingState } from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ExamShell } from '../components/exam/engine/exam-shell';
import { useExamView, type EndedSitting } from '../components/exam/engine/use-exam-view';
import { templateFor } from '../components/exam/templates/registry';

interface BeganWith {
  languages?: LanguageCode[];
}

export function ExamPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const { identity: student } = useAuth();
  const began = (useLocation().state ?? {}) as BeganWith;

  const attempt = useQuery({
    queryKey: ['me', 'attempt', testId],
    queryFn: () => api.me.startAttempt(testId, { languages: began.languages }),
    enabled: testId !== '',
    // The sitting is started once; a refetch would be a second start, which the server resumes.
    staleTime: Infinity,
    retry: false,
  });

  const attemptId = attempt.data?.id ?? '';
  const paper = useQuery({
    queryKey: ['me', 'attempt-paper', attemptId],
    // Stamped where the payload LANDS, never in a render: that instant is the clock's anchor.
    queryFn: async () => ({ paper: await api.me.attemptPaper(attemptId), arrivedAt: Date.now() }),
    enabled: attemptId !== '',
    staleTime: Infinity,
  });

  if (attempt.isError) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          This test cannot be started right now. Go back to your tests and check when it opens.
        </Alert>
      </div>
    );
  }

  if (!paper.data || !attempt.data) {
    return <LoadingState>Opening your paper</LoadingState>;
  }

  return (
    <ExamHall
      paper={paper.data.paper}
      arrivedAt={paper.data.arrivedAt}
      title={attempt.data.testTitle}
      // The one thing on the paper that leads back to a person: there is no enrolment number.
      watermark={student?.mobile ?? ''}
      // `replace`: Back must never re-enter a paper that has been handed in.
      onEnded={(ended) => {
        navigate(ROUTES.SUBMITTED(ended.attemptId), { replace: true, state: ended });
      }}
    />
  );
}

function ExamHall(
  sitting: Readonly<{
    paper: ExamPaper;
    arrivedAt: number;
    title: string | null;
    watermark: string;
    onEnded: (ended: EndedSitting) => void;
  }>,
) {
  const view = useExamView(sitting);

  return <ExamShell template={templateFor(sitting.paper.examTemplate)} view={view} />;
}
