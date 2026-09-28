import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, TooltipProvider } from '@iace/ui';

/** Boots a SPA into `#root`. Throws on a missing container rather than falling back to body. */
export function mountApp(app: ReactNode, options: { queryClient: QueryClient; rootId?: string }) {
  const { queryClient, rootId = 'root' } = options;

  const container = document.getElementById(rootId);
  if (!container) throw new Error(`Root element #${rootId} not found`);

  // Order matters: query client outside auth, theme outside everything it paints, Toaster inside the theme but outside the router.
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* Once, high in the app. The timing lives in @iace/ui. */}
          <TooltipProvider>
            <BrowserRouter>{app}</BrowserRouter>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
