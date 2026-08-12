import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@iace/ui';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { api } from '../lib/api';
import { ME_QUERY_KEY, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth-context';

/**
 * Where a student lands.
 *
 * Deliberately almost empty. In V1 this becomes the Report dashboard — rank,
 * percentile, the last paper — and anything put here now is something that has
 * to be taken away then. It carries no header of its own: the shell already has
 * one, and having both drew two navbars down the page.
 *
 * TODO(access): the test list here is Student -> Group -> TestSeries -> Test;
 * there are no direct grants to check.
 */
export function DashboardPage() {
  const { student } = useAuth();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => api.me.profile() });

  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <Avatar
          src={me.data?.profile?.photoUrl}
          name={student?.fullName}
          fallback={student?.mobile}
          size="lg"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {student?.fullName ? `Welcome, ${student.fullName}` : 'Welcome'}
          </h1>
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">+91 {student?.mobile}</p>
        </div>
      </div>

      <PreTestPrompt preTestReady={student?.preTestReady ?? true} />

      <Card>
        <CardHeader>
          <CardTitle>Your tests will appear here</CardTitle>
          <CardDescription>
            Nothing scheduled yet. When your batch is given a test, it shows up on this page along
            with your result once it has been marked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.PROFILE}>View your profile</Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
