import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@iace/ui';

/**
 * The gate in front of every authed route. Waits rather than deciding while the
 * identity loads, or a reload bounces to login for a frame. `state.from` is the way back.
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
