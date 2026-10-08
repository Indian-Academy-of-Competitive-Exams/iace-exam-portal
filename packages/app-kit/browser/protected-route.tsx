import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { EMPTY_STATE_KINDS, EmptyState, Spinner } from '@iace/ui';

const WHOLE_SCREEN = 'flex min-h-[100dvh] items-center justify-center bg-background';

/** The gate in front of every authed route; waits rather than deciding while identity loads, and `state.from` is the way back after login. */
export function ProtectedRoute({
  isAuthenticated,
  isLoading,
  isUnreachable = false,
  onRetry,
  loginPath,
}: Readonly<{
  isAuthenticated: boolean;
  isLoading: boolean;
  /** A session is held but the server did not answer: nobody signed out, so the address is kept. */
  isUnreachable?: boolean;
  onRetry?: () => void;
  loginPath: string;
}>) {
  const location = useLocation();

  if (isLoading) {
    return (
      <div className={WHOLE_SCREEN}>
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }

  if (isUnreachable) {
    return (
      <div className={WHOLE_SCREEN}>
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not reach the server"
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate to={loginPath} replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  return <Outlet />;
}
