import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { type QueryClient } from '@tanstack/react-query';
import { AppProviders } from './app-providers';

/**
 * Boots a SPA into `#root`.
 *
 * Each app's `main.tsx` was byte-for-byte identical, which is the clearest
 * possible sign it should not have been in an app at all. What is left there
 * now is the CSS imports (which must be static, so a bundler can see them) and
 * one call.
 *
 * The missing-container check throws rather than falling back to `document.body`
 * — a silently different mount point is a blank page nobody can explain.
 */
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
