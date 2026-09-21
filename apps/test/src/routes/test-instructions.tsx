import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, EMPTY_STATE_KINDS, LoadingState } from '@iace/ui';
import { useFullscreen } from '@iace/app-kit/browser';
import { briefQuery } from '../lib/queries';
import { ROUTES } from '../lib/constants';
import { InstructionsShell } from '../components/exam/instructions/instructions-shell';

/** What a student reads before the clock starts. Nothing here starts it — the last button does. */

export function TestInstructionsPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const fullscreen = useFullscreen();

  // The paper's code is fetched while they read, so pressing begin never waits on a download.
  useEffect(() => {
    void import('./exam');
  }, []);

  const brief = useQuery({
    ...briefQuery(testId),
    enabled: testId !== '',
  });

  // A skeleton would have to guess the shape, and which skin draws these screens arrives with the brief.
  if (brief.isLoading) {
    return (
      <div className="grid h-dvh place-items-center">
        <LoadingState>Opening your instructions</LoadingState>
      </div>
    );
  }

  if (!brief.data) {
    return (
      <div className="p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="This test is not open to you"
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.TESTS}>Go to your tests</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <InstructionsShell
      brief={brief.data}
      fullscreenSupported={fullscreen.isSupported}
      onBegin={(languages) => {
        // Asked for again HERE because the walk up may have been refused, and this click is a gesture.
        void fullscreen.enter();
        navigate(ROUTES.EXAM(testId), { state: { languages } });
      }}
    />
  );
}
