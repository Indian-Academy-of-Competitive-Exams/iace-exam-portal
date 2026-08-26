import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Alert, Spinner } from '@iace/ui';
import { api } from '../lib/api';

/** The slim version of ThinkExam's four-step check: three facts, so a student learns them here. */

const SUPPORTED = ['Chrome', 'Edge', 'Firefox', 'Safari'];

const browserIsSupported = (): boolean =>
  SUPPORTED.some((name) => navigator.userAgent.includes(name));

export function SystemCheck() {
  // The session is proven by the call succeeding, which is also the reachability check.
  const reachable = useQuery({
    queryKey: ['me', 'system-check'],
    queryFn: () => api.auth.me(),
    retry: false,
    staleTime: 0,
  });

  const checks = [
    { label: 'Your browser is supported', ok: browserIsSupported() },
    { label: 'You are signed in', ok: reachable.isSuccess },
    { label: 'The exam server is reachable', ok: reachable.isSuccess },
  ];
  const failed = checks.filter((check) => !check.ok);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">System check</h2>

      {reachable.isLoading ? (
        <Spinner label="Checking your system" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-2 text-sm">
              {check.ok ? (
                <Check aria-hidden className="size-4 shrink-0 text-success" />
              ) : (
                <X aria-hidden className="size-4 shrink-0 text-destructive" />
              )}
              <span className={check.ok ? 'text-foreground' : 'text-destructive'}>
                {check.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && !reachable.isLoading ? (
        <Alert variant="warning">
          Fix this before you begin. Sitting a test on a browser we cannot support risks losing
          answers, and the clock does not stop while you sort it out.
        </Alert>
      ) : null}
    </section>
  );
}
