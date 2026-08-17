import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, TooltipProvider } from '@iace/ui';
import { type ReactNode } from 'react';

/**
 * The provider stack, in the order that matters: query client outside auth,
 * theme outside everything it paints, Toaster inside the theme but outside the router.
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
