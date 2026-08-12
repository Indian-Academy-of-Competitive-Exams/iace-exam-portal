import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Alert, Button } from '@iace/ui';
import { ROUTES } from '../lib/constants';

/**
 * The pre-test gate: mother's name, father's name and date of birth.
 *
 * A PROMPT, never a wall. These three go on the hall ticket and the answer
 * sheet, so a test taken without them is a result nobody can match to a person
 * — but a student sitting down five minutes before a paper starts must not be
 * met by a form they cannot skip. It asks, and it keeps asking, and it lets
 * them past.
 *
 * `profileCompleted` — the full profile — never appears here. That one is a
 * nudge and nothing more.
 *
 * TODO(exam engine): render this on the way into a test as well as here, and
 * carry the student back to where they were once they have filled it in.
 */
export function PreTestPrompt({ preTestReady }: { preTestReady: boolean }) {
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
