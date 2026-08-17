import { PageHeader } from '@iace/ui';
import { useAuth } from '../providers/auth';

/** Landing screen, deliberately bare until there is something built to put on it. */
export function DashboardPage() {
  const { identity: admin } = useAuth();

  return (
    <PageHeader
      title={admin?.fullName ? `Welcome, ${admin.fullName}` : 'Welcome'}
      description="User management is live. Question bank and tests come next."
    />
  );
}
