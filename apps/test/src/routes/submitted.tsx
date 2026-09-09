/**
 * The moment after a paper is handed in. Marking is a queued job, so the score
 * card does not exist yet — this shows what the sitting knows about ITSELF, and
 * moves on to the score card as soon as the marking lands.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppException, ErrorCodes } from '@iace/contracts';
import { Alert, LoadingState, PageFrame, PageHeader, plural } from '@iace/ui';
import { pollDelayMs, shouldKeepPolling } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { DividedList, DividedRow, PageBody, Section } from '../components/ui';
import { NAV_ITEMS, ROUTES, scoreCardQueryKey } from '../lib/constants';
import { type EndedSitting } from '../components/exam/engine/use-exam-view';

/** A queued marking job is the only reason the card 409s; anything else is a real failure. */
const isPending = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;

export function SubmittedPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const handedIn = useLocation().state as EndedSitting | null;

  const card = useQuery({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
    enabled: attemptId !== '',
    retry: (count, error) => isPending(error) && shouldKeepPolling(count),
    retryDelay: (count) => pollDelayMs(count),
  });

  const marked = card.data !== undefined;
  useEffect(() => {
    if (marked) navigate(ROUTES.SCORE_CARD(attemptId), { replace: true });
  }, [marked, attemptId, navigate]);

  const failed = card.isError;

  return (
    <PageFrame
      header={
        <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} size="display" title="Handed in" />
      }
    >
      <PageBody>
        {handedIn ? <OwnEffort sitting={handedIn} /> : null}

        <Section title="Marking">
          {failed ? (
            <Alert variant="danger">
              Your score card did not load. It is safe — open it from your performance.
            </Alert>
          ) : (
            <LoadingState>Marking your paper</LoadingState>
          )}
        </Section>
      </PageBody>
    </PageFrame>
  );
}

/** Their own paper, not the cohort's: nothing here needs the marking to have run. */
function OwnEffort({ sitting }: Readonly<{ sitting: EndedSitting }>) {
  return (
    <Section title="Your paper">
      <DividedList>
        {sitting.sections.map((section) => (
          <DividedRow
            key={section.id}
            title={section.name}
            meta={`${plural(section.total, 'question')} · ${section.attempted} attempted · ${section.unattempted} unattempted`}
          />
        ))}
      </DividedList>
    </Section>
  );
}
