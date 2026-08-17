import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Alert, Button } from '@iace/ui';
import { ROUTES } from '../lib/constants';

/**
 * The pre-test gate: mother's name, father's name, DOB. A PROMPT, never a wall.
 * Rendered on the profile only; the exam engine will also show it on the way into a test.
 */
export function PreTestPrompt({ preTestReady }: Readonly<{ preTestReady: boolean }>) {
  if (preTestReady) return null;

  return (
    <Alert variant="warning" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-2">
          <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-medium">Before your first test.</strong> We need your
            mother&rsquo;s name, father&rsquo;s name and date of birth — they go on your hall
            ticket. It takes a minute.
          </span>
        </span>
        <Button size="sm" asChild>
          <Link to={ROUTES.PROFILE}>Add them</Link>
        </Button>
      </div>
    </Alert>
  );
}
