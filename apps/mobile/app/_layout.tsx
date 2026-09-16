import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@iace/app-kit';
import * as SplashScreen from 'expo-splash-screen';
import { hydrate } from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/providers/auth';
import '../global.css';

void SplashScreen.preventAutoHideAsync();

const queryClient = createAppQueryClient();

export default function RootLayout() {
  const [hydrated, setHydrated] = useState(false);

  // The token store must not be read before this resolves, or a returning student is signed out.
  useEffect(() => {
    void hydrate().then(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Navigation />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Guards the two routes that exist today; a route with no guard stays reachable either way. */
function Navigation() {
  const { identity, isLoading } = useAuth();
  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={Boolean(identity)}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!identity}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
