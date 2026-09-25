import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@iace/ui';

/** The gate in front of every authed route; waits rather than deciding while identity loads, and `state.from` is the way back after login. */
export function ProtectedRoute({
  isAuthenticated,
  isLoading,
  loginPath,
}: Readonly<{ isAuthenticated: boolean; isLoading: boolean; loginPath: string }>) {
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
