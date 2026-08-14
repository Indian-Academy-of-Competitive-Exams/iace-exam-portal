import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, TooltipProvider } from '@iace/ui';
import { type ReactNode } from 'react';

/**
 * The provider stack every IACE SPA runs inside, in the order that matters.
 *
 * The order is not arbitrary and is the reason this is shared rather than
 * copied: the query client has to be outside the auth provider (which queries),
 * the theme has to be outside everything it paints, and the `<Toaster />` has to
 * be inside the theme but outside the router — a toast raised by a mutation
 * during a navigation must not unmount with the route that raised it.
 *
 * `children` goes inside the router, so an app's own auth provider and routes
 * both see it.
 */
export function AppProviders({
  queryClient,
  children,
}: Readonly<{ queryClient: QueryClient; children: ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Once, high in the app. The timing lives in @iace/ui. */}
        <TooltipProvider>
          <BrowserRouter>{children}</BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
