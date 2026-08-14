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
  PageHeader,
} from '@iace/ui';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { api } from '../lib/api';
import { PROFILE_QUERY_KEY, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';

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
  const { identity: student } = useAuth();
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  return (
    <>
      <PageHeader
        leading={
          <Avatar
            src={me.data?.profile?.photoUrl}
            name={student?.fullName}
            fallback={student?.mobile}
            size="lg"
          />
        }
        title={student?.fullName ? `Welcome, ${student.fullName}` : 'Welcome'}
        description={<span className="tabular-nums">+91 {student?.mobile}</span>}
      />

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
