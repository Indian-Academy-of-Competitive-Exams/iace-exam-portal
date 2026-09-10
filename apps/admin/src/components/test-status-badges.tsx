import { TEST_STATUS, type TestStatus } from '@iace/contracts';
import { Badge } from '@iace/ui';
import { TEST_STATUS_LABELS } from '../lib/constants';

/** Draft, finalized and offered are three states: the freeze and the status say different things. */
export function TestStatusBadges({
  status,
  isLocked,
}: Readonly<{ status: TestStatus; isLocked: boolean }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {isLocked ? <Badge variant="warning">Finalized</Badge> : null}
      <Badge variant={status === TEST_STATUS.ACTIVE ? 'success' : 'neutral'}>
        {TEST_STATUS_LABELS[status]}
      </Badge>
    </span>
  );
}
