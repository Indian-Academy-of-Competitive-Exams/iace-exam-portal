import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@iace/ui';
import { useAuth } from '../providers/auth';

/** Landing screen. The header, nav and sign-out live in AppShell. */
export function DashboardPage() {
  const { identity: admin } = useAuth();

  return (
    <>
      <PageHeader
        title={admin?.fullName ? `Welcome, ${admin.fullName}` : 'Welcome'}
        description="User management is live. Question bank and tests come next."
      />

      <Card>
        <CardHeader>
          <CardTitle>Where to start</CardTitle>
          <CardDescription>
            Create groups first — a student can only reach tests through one — then add or import
            students into them.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{admin?.email}</span>
          {admin?.isSuperAdmin ? ' (super admin — every page is reachable)' : null}
        </CardContent>
      </Card>
    </>
  );
}
