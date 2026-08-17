import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@iace/ui';

/**
 * The gate in front of every authed route.
 *
 * Three states, and the middle one is the whole point: while the identity is
 * still being read, this shows a spinner rather than deciding. Without that,
 * a reload of any authed page bounces to the login screen for a frame before
 * bouncing back — which looks like being signed out at random.
 *
 * `state.from` is what lets the login screen return the user to where they were
 * going instead of to the dashboard.
 */
export function ProtectedRoute({
  isAuthenticated,
  isLoading,
  loginPath,
}: Readonly<{ isAuthenticated: boolean; isLoading: boolean; loginPath: string }>) {
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
