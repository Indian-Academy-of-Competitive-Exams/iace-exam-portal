import { LogOut } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@iace/ui';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

/**
 * The authed shell. In V1 this route becomes the Report dashboard — the
 * student's post-login landing page — not a raw test list.
 *
 * TODO(pre-test gate): when `student.preTestReady` is false, prompt for
 * mother's name, father's name and DOB on the way into a test. A short prompt,
 * not a wall — `profileCompleted` (the full profile) never blocks anything.
 * TODO(access): the test list here is Student -> Group -> TestSeries -> Test;
 * there are no direct grants to check.
 */
export function DashboardPage() {
  const { student, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-foreground">IACE</span>
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome{student?.fullName ? `, ${student.fullName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">+91 {student?.mobile}</p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Your report will live here</CardTitle>
            <CardDescription>
              Phase 0 is the foundation only — infrastructure, design system and PIN sign-in. Tests,
              results and rank arrive with the mock-test feature.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6 text-sm">
            <Stat label="Test details" value={student?.preTestReady ? 'On file' : 'Needed'} />
            <Stat label="Profile" value={student?.profileCompleted ? 'Complete' : 'Incomplete'} />
            <Stat label="Language" value={student?.preferredLanguage.toUpperCase() ?? '—'} />
            <Stat label="Tests taken" value="0" />
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
