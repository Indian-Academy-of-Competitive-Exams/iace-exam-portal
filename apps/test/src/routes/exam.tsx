/**
 * The exam hall. It starts the sitting, hands the engine the paper and lets the
 * chosen template draw it — the screen itself decides nothing about how a
 * sitting behaves, and a skin decides nothing about what it saves.
 */
import { useEffect } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AppException, ErrorCodes, type ExamPaper, type LanguageCode } from '@iace/contracts';
import { Button, EmptyState, EMPTY_STATE_KINDS, LoadingState, plural } from '@iace/ui';
import { useExamView, useStartedSitting, type EndedSitting } from '@iace/app-kit';
import { browserSessionStorage, useFullscreen } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY, RESUME_PARAM, ROUTES, STORAGE_KEYS } from '../lib/constants';
import { tabId } from '../lib/tab-id';
import { useAuth } from '../providers/auth';
import { ExamShell } from '../components/exam/engine/exam-shell';

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
            <Button asChild variant="outline">
              <Link to={ROUTES.TESTS}>Go to your tests</Link>
            </Button>
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
  const focus = useFullscreen();
  const view = useExamView(sitting, {
    api,
    focus,
    catalogQueryKey: CATALOG_QUERY_KEY,
    tab: tabId(),
    answerQueue: { storage: browserSessionStorage, keyPrefix: STORAGE_KEYS.QUEUED_ANSWERS },
  });
  useLeaveGuard(view.hasUnsent, view.leave);

  if (view.takenOver) {
    return (
      <div className="p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="This paper is being answered somewhere else"
          /* ui-copy-ok: consequence — continuing here is what stops the other one */
          hint={takenOverSays(view.droppedUnsaved)}
          action={
            <Button onClick={() => continueHere(sitting.paper.attemptId)}>Continue here</Button>
          }
        />
      </div>
    );
  }

  return <ExamShell examTemplate={sitting.paper.examTemplate} view={view} />;
}

/** The other device's answers stand, so whatever this one had not saved is named, not silently lost. */
function takenOverSays(dropped: number): string {
  const kept =
    dropped === 0
      ? 'Your answers are saved.'
      : `${plural(dropped, 'answer')} given here had not saved and will not be kept.`;
  return `${kept} Continuing here stops the other tab or device.`;
}

/** Closing or reloading with answers unsent asks first; going anyway sends them on the way out. */
function useLeaveGuard(hasUnsent: () => boolean, leave: () => void) {
  useEffect(() => {
    // The browser writes the prompt itself; all a page may do is ask for it.
    const ask = (event: BeforeUnloadEvent) => {
      if (hasUnsent()) event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    // pagehide, not unload: it fires on mobile browsers and when the page goes into the back-forward cache.
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('beforeunload', ask);
      window.removeEventListener('pagehide', leave);
    };
  }, [hasUnsent, leave]);
}

/** Names the sitting, so a paper handed in elsewhere lands on its result instead of restarting. */
function continueHere(attemptId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(RESUME_PARAM, attemptId);
  window.location.replace(url);
}
