import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, EMPTY_STATE_KINDS, PageFrame, PageHeader, SkeletonParagraph } from '@iace/ui';
import { PageCrumbs, useFullscreen } from '@iace/app-kit/browser';
import { briefQuery } from '../lib/queries';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
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

  if (brief.isLoading) {
    return (
      <PageFrame
        header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Instructions" />}
      >
        <SkeletonParagraph lines={6} />
      </PageFrame>
    );
  }

  if (!brief.data) {
    return (
      <PageFrame
        header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Instructions" />}
      >
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This test is not open to you" />
      </PageFrame>
    );
  }

  return (
    <InstructionsShell
      brief={brief.data}
      fullscreenSupported={fullscreen.isSupported}
      onBegin={(languages) => {
        // Asked for HERE because entering needs a gesture, and this click is the only one.
        void fullscreen.enter();
        navigate(ROUTES.EXAM(testId), { state: { languages } });
      }}
    />
  );
}
