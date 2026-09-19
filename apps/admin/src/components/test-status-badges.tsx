import { TEST_STATUS, type TestStatus } from '@iace/contracts';
import { Badge } from '@iace/ui';
import { TEST_STATUS_LABELS } from '../lib/constants';

/** Frozen and offered are two facts: a retired test still carries the frozen paper it went out with. */
export function TestStatusBadges({
  status,
  finalizedAt,
}: Readonly<{ status: TestStatus; finalizedAt: string | null }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {finalizedAt === null ? null : <Badge variant="warning">Finalized</Badge>}
      <Badge variant={status === TEST_STATUS.ACTIVE ? 'success' : 'neutral'}>
        {TEST_STATUS_LABELS[status]}
      </Badge>
    </span>
  );
}
