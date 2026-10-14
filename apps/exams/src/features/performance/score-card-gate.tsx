import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, EMPTY_STATE_KINDS } from '@iace/ui';
import { isMarkingPending, isSittingVoided } from '@iace/app-kit';
import type { ScoreCard } from '@iace/contracts';
import { ReportSkeleton } from '../../components/ui';
import { SittingSetAside } from './report';

export function ScoreCardGate({
  card,
  failed,
  children,
}: Readonly<{
  card: UseQueryResult<ScoreCard, unknown>;
  failed: string;
  children: (data: ScoreCard) => ReactNode;
}>) {
  const again = () => void card.refetch();

  if (card.isLoading) return <ReportSkeleton />;
  if (isSittingVoided(card.error)) return <SittingSetAside />;
  // Reached before the queued job ran, which is ordinary now that nothing polls on the student's behalf.
  if (isMarkingPending(card.error)) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.EMPTY}
        title="No marks yet"
        // ui-copy-ok: consequence
        hint="Your paper is handed in and safe."
        onRetry={again}
      />
    );
  }
  if (!card.data) {
    return <EmptyState kind={EMPTY_STATE_KINDS.FAILURE} title={failed} onRetry={again} />;
  }

  return children(card.data);
}
