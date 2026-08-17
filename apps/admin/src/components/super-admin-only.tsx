import { type ReactNode } from 'react';
import { Alert, PageHeader } from '@iace/ui';
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
