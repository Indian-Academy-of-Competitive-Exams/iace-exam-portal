import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, TooltipProvider, toast } from '@iace/ui';
import { createAppQueryClient } from '@iace/app-kit';
import { AuthProvider } from './auth-provider';

/**
 * One client, one place every mutation failure is announced.
 *
 * `toast` is a module-level store, so it works from here — outside any
 * component — which is what lets the catch-all live in the client rather than
 * in each form. Field-level messages still land on their fields; this only sees
 * what has nowhere else to go.
 */
const queryClient = createAppQueryClient({ notify: toast });

export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Once, high in the app. The timing lives in @iace/ui. */}
        <TooltipProvider>
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
