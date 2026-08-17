import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { type QueryClient } from '@tanstack/react-query';
import { AppProviders } from './app-providers';

/** Boots a SPA into `#root`. Throws on a missing container rather than falling back to body. */
export function mountApp(app: ReactNode, options: { queryClient: QueryClient; rootId?: string }) {
  const { queryClient, rootId = 'root' } = options;

  const container = document.getElementById(rootId);
  if (!container) throw new Error(`Root element #${rootId} not found`);

  createRoot(container).render(
    <StrictMode>
      <AppProviders queryClient={queryClient}>{app}</AppProviders>
    </StrictMode>,
  );
}
