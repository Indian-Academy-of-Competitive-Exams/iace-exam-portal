import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button, EMPTY_STATE_KINDS, EmptyState } from '@iace/ui';
import { ROUTES } from '../lib/constants';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background p-6">
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        icon={FileQuestion}
        title="This page does not exist"
        hint="The address may have changed, or the test behind it is no longer offered."
        action={
          <Button asChild>
            <Link to={ROUTES.HOME}>Go to your tests</Link>
          </Button>
        }
      />
    </div>
  );
}
