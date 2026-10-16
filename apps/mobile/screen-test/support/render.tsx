import { type ComponentType, type ReactNode } from 'react';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../src/providers/auth';

function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

function Layout() {
  return (
    <Providers>
      <Slot />
    </Providers>
  );
}

/** The app's providers over a router holding only the routes a test names. */
export const renderRoutes = (routes: Record<string, ComponentType>, initialUrl: string) =>
  renderRouter({ _layout: Layout, ...routes }, { initialUrl });
