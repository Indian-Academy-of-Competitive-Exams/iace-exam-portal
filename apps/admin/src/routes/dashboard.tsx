import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { useAuth } from '../providers/auth-context';

/** Landing screen. The header, nav and sign-out live in AppShell. */
export function DashboardPage() {
  const { admin } = useAuth();

  return (
    <>
      <PageHeader
        title={`Welcome${admin?.fullName ? `, ${admin.fullName}` : ''}`}
        description="User management is live. Question bank and tests come next."
      />

      <Card>
        <CardHeader>
          <CardTitle>Where to start</CardTitle>
          <CardDescription>
            Create batches first — a student can only reach tests through one — then add or import
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
