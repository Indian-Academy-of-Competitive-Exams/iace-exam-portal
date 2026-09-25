import { type ReactNode } from 'react';
import { EmptyState, EMPTY_STATE_KINDS, PageHeader } from '@iace/ui';
import { useAuth } from '../providers/auth';

// Gate for the three super-admin screens; not the security boundary — every endpoint behind them is @RequiresSuperAdmin.
export function SuperAdminOnly({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  const { identity: admin } = useAuth();

  if (!admin?.isSuperAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={title} />
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="Only a super admin can open this"
          hint="Ask one to grant you super admin."
        />
      </div>
    );
  }

  return <>{children}</>;
}
