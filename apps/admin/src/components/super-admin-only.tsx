import { type ReactNode } from 'react';
import { EmptyState, EMPTY_STATE_KINDS, PageHeader } from '@iace/ui';
import { useAuth } from '../providers/auth';

/**
 * One gate for the three super-admin screens. Renders a refusal rather than redirecting.
 * Not the security boundary — every endpoint behind them is `@RequiresSuperAdmin`.
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
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="Only a super admin can open this"
          hint="Ask one to grant you super admin."
        />
      </>
    );
  }

  return <>{children}</>;
}
