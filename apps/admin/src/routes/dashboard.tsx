import { LogOut, ShieldCheck } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@iace/ui';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

/**
 * The authed admin shell. Question bank, test builder, students, access grants
 * and reports mount here as their features land.
 */
export function DashboardPage() {
  const { admin, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            IACE <span className="text-muted-foreground">Admin</span>
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {admin?.fullName ?? admin?.email}
          </h1>
          {admin?.isSuperAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2.5 py-1 text-xs font-medium text-info-ink">
              <ShieldCheck className="size-3.5" aria-hidden />
              Super admin
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{admin?.email}</p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Admin panel</CardTitle>
            <CardDescription>
              Phase 0 is the foundation only — infrastructure, design system and OTP sign-in. The
              question bank, test builder and reports arrive with the mock-test feature.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6 text-sm">
            <Stat
              label="Access"
              value={
                admin?.isSuperAdmin
                  ? 'All pages'
                  : `${admin?.pages.length ?? 0} page${admin?.pages.length === 1 ? '' : 's'}`
              }
            />
            <Stat label="Questions" value="0" />
            <Stat label="Tests" value="0" />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground">{value}</span>
    </div>
  );
}
