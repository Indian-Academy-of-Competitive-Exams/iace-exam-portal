import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@iace/ui';
import { ThemeProvider } from './theme-provider';
import { AuthProvider } from './auth-provider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live tests mean flaky mobile networks — retry once, but never hammer.
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/*
         * One provider for the whole app: the delay is shared, so crossing a
         * column of truncated names opens one tooltip rather than a flicker of
         * them. `skipDelayDuration` is what makes moving between neighbours
         * feel instant once the first has opened.
         *
         * `disableHoverableContent` because ours only ever hold text. Radix
         * otherwise keeps a grace area alive between trigger and content so a
         * pointer can travel into it — and while it believes the pointer is in
         * transit, the NEXT trigger will not open. Moving from a truncated
         * group name to the "+N" beside it hit exactly that, and nothing
         * appeared.
         */}
        <TooltipProvider delayDuration={300} skipDelayDuration={200} disableHoverableContent>
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
