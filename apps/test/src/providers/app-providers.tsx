import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, TooltipProvider } from '@iace/ui';
import { createAppQueryClient } from '@iace/app-kit';
import { AuthProvider } from './auth-provider';

const queryClient = createAppQueryClient();

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Once, high in the app. The timing lives in @iace/ui. */}
        <TooltipProvider>
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
