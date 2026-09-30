/**
 * The exam hall. It starts the sitting, hands the engine the paper and lets the
 * chosen template draw it — the screen itself decides nothing about how a
 * sitting behaves, and a skin decides nothing about what it saves.
 */
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AppException, ErrorCodes, type ExamPaper, type LanguageCode } from '@iace/contracts';
import { Button, EmptyState, EMPTY_STATE_KINDS, LoadingState } from '@iace/ui';
import { stoodDownSays, useExamView, useStartedSitting, type EndedSitting } from '@iace/app-kit';
import { browserSessionStorage, useFullscreen, useLeaveGuard } from '@iace/app-kit/browser';
import { api } from '../../lib/api';
import { CATALOG_QUERY_KEY, RESUME_PARAM, ROUTES, STORAGE_KEYS } from '../../lib/constants';
import { tabId } from '../../lib/tab-id';
import { useAuth } from '../../providers/auth';
import { ExamShell } from './exam-shell';

interface BeganWith {
  languages?: LanguageCode[];
}

export function ExamPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const { identity: student } = useAuth();
  const began = (useLocation().state ?? {}) as BeganWith;
  const resume = useSearchParams()[0].get(RESUME_PARAM) ?? undefined;

  const { attempt, paper } = useStartedSitting(api, testId, {
    languages: began.languages,
    tab: tabId(),
    resume,
  });

  if (attempt.isError) {
    const { error } = attempt;
    if (resume && AppException.is(error) && error.code === ErrorCodes.SITTING_ENDED) {
      return <Navigate to={ROUTES.SUBMITTED(resume)} replace />;
    }
    return (
      <div className="p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This test could not be started"
          /* ui-copy-ok: rule — when it opens is the one thing that decides whether they can */
          hint="Check when it opens on your tests."
          action={
            // Retry first: at a synchronised open the server being busy is likelier than the test being shut.
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={() => void attempt.refetch()}>Retry</Button>
              <Button asChild variant="outline">
                <Link to={ROUTES.TESTS}>Go to your tests</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (paper.isError) {
    return (
      <div className="p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Your paper did not load"
          /* ui-copy-ok: consequence — waiting here costs the candidate time */
          hint="The clock is running on the server."
          onRetry={() => void paper.refetch()}
        />
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
      startedByThisCall={attempt.data.startedByThisCall}
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
    startedByThisCall: boolean;
    title: string | null;
    watermark: string;
    onEnded: (ended: EndedSitting) => void;
  }>,
) {
  const focus = useFullscreen();
  const view = useExamView(sitting, {
    api,
    focus,
    catalogQueryKey: CATALOG_QUERY_KEY,
    tab: tabId(),
    answerQueue: { storage: browserSessionStorage, keyPrefix: STORAGE_KEYS.QUEUED_ANSWERS },
  });
  const releaseLeave = useLeaveGuard(view.hasUnsent, view.leave);

  if (view.takenOver) {
    const says = stoodDownSays(view);
    return (
      <div className="p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title={says.title}
          /* ui-copy-ok: consequence — continuing here is what stops the other one */
          hint={says.hint}
          action={
            <Button
              onClick={() => {
                // What is unsent here is the next load's to settle, so this reload asks nothing.
                releaseLeave();
                continueHere(sitting.paper.attemptId);
              }}
            >
              Continue here
            </Button>
          }
        />
      </div>
    );
  }

  return <ExamShell examTemplate={sitting.paper.examTemplate} view={view} />;
}

/** Names the sitting, so a paper handed in elsewhere lands on its result instead of restarting. */
function continueHere(attemptId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(RESUME_PARAM, attemptId);
  window.location.replace(url);
}
