import { type ReactNode } from 'react';
import { Alert, PageHeader } from '@iace/ui';
import { useAuth } from '../providers/auth';

/**
 * The three super-admin screens share one gate, so they cannot drift into
 * saying three different things when somebody reaches them without the right.
 *
 * It renders a refusal rather than redirecting. A redirect to the dashboard
 * looks like the link was broken; this says what happened, which is the
 * difference between a product that refused you and one that lost you.
 *
 * This is NOT the security boundary — every endpoint behind these screens is
 * `@RequiresSuperAdmin` server-side. Reaching this component with a pasted URL
 * gets you a page that renders and then fails every request it makes, so the
 * gate exists to make that a sentence instead of a wall of errors.
 */
export function SuperAdminOnly({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  const { identity: admin } = useAuth();

  if (!admin?.isSuperAdmin) {
    return (
      <>
        <PageHeader title={title} />
        <Alert variant="warning">
          <span>
            Only a super admin can open this. If you need it, ask one to grant you super admin.
          </span>
        </Alert>
      </>
    );
  }

  return <>{children}</>;
}
