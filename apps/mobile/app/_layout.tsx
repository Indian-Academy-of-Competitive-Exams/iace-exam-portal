import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, useColorScheme, View } from 'react-native';
import { Stack, usePathname, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@iace/app-kit';
import * as SplashScreen from 'expo-splash-screen';
import { EmptyState, EMPTY_STATE_KINDS } from '../src/components/ui/empty-state';
import { alertOnce } from '../src/lib/alert-once';
import { hydrate } from '../src/lib/api';
import { linkGuard } from '../src/lib/link-guard';
import { EXAM_PATH } from '../src/lib/nav';
import { AuthProvider, useAuth } from '../src/providers/auth';
import { useTokenColor } from '../src/lib/use-token-color';
import { usePushDevice } from '../src/lib/use-push-device';
import { TourProvider } from '../src/lib/page-tour';
import '../global.css';

void SplashScreen.preventAutoHideAsync();

// Reported by the button and by the dismissal: Android sends one or the other, never both.
const raiseAlert = alertOnce((message, onDismiss) =>
  Alert.alert(message, undefined, [{ text: 'OK', onPress: onDismiss }], { onDismiss }),
);

// A failure no field on screen shows is said out loud, as the web's toast does; success stays quiet.
const queryClient = createAppQueryClient({
  notify: { error: raiseAlert, success: () => undefined },
});

// A link opened cold lands on its screen with the tabs beneath it, so Back never leaves the app.
export const unstable_settings = { anchor: '(tabs)' };

const WHOLE_SCREEN = 'flex-1 items-center justify-center bg-background px-6';

/** Drawn outside every provider, so it may use none of them. */
export function ErrorBoundary({ retry }: Readonly<ErrorBoundaryProps>) {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View className={WHOLE_SCREEN}>
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Something went wrong"
        onRetry={() => void retry()}
      />
    </View>
  );
}

export default function RootLayout() {
  const [hydrated, setHydrated] = useState(false);

  // The token store must not be read before this resolves, or a returning student is signed out.
  useEffect(() => {
    void hydrate().then(() => setHydrated(true));
  }, []);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TourProvider>
          <Navigation />
        </TourProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Every route is registered under a guard; a route with no guard stays reachable either way. */
function Navigation() {
  const { identity, isLoading, isUnreachable, retry } = useAuth();
  usePushDevice(Boolean(identity));
  const insets = useSafeAreaInsets();
  const pageColor = useTokenColor('--background');
  const headerColor = useTokenColor('--surface');
  const headerInk = useTokenColor('--foreground');
  const spinner = useTokenColor('--muted-foreground');
  const statusBarStyle = useColorScheme() === 'dark' ? 'light' : 'dark';
  const pathname = usePathname();
  const router = useRouter();

  // Held until the session is known, so the first thing seen is Home, Sign in or the retry screen.
  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync();
  }, [isLoading]);

  useEffect(() => {
    linkGuard.setSitting(pathname.startsWith(EXAM_PATH));
  }, [pathname]);

  // Unreachable is neither signed in nor out, so it settles nothing.
  useEffect(() => {
    if (isLoading || isUnreachable) return;
    const turnedAway = linkGuard.settle(Boolean(identity));
    // A tick later: the stack has not yet swapped the sign-in screen for the tabs, and a push now would meet the old one.
    if (turnedAway) setTimeout(() => router.push(turnedAway), 0);
  }, [identity, isLoading, isUnreachable, router]);

  if (isLoading) {
    return (
      <View className={WHOLE_SCREEN}>
        <ActivityIndicator color={spinner} />
      </View>
    );
  }

  // A session is held and the server did not answer: nobody signed out, so this is not the sign-in screen.
  if (isUnreachable) {
    return (
      <View className={WHOLE_SCREEN}>
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not reach the server"
          onRetry={retry}
        />
      </View>
    );
  }

  // A pushed page ends above the home indicator; the tab bar and the exam hold that space themselves.
  const page = {
    headerShown: true,
    // The header is navigator chrome, so it takes colours rather than classes, as the tab bar does.
    headerStyle: { backgroundColor: headerColor },
    headerTintColor: headerInk,
    contentStyle: { paddingBottom: insets.bottom, backgroundColor: pageColor },
  };

  return (
    // Chevron only: iOS would otherwise label Back with the route group's name, "(tabs)".
    <Stack
      screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal', statusBarStyle }}
    >
      <Stack.Protected guard={Boolean(identity)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="series/[id]" options={page} />
        <Stack.Screen name="test/[id]/index" options={page} />
        <Stack.Screen name="test/[id]/instructions" options={page} />
        {/* No swipe back out of a running paper; Android's Back is intercepted by the screen itself. */}
        <Stack.Screen
          name="exam/[testId]"
          options={{ gestureEnabled: false }}
          dangerouslySingular
        />
        <Stack.Screen
          name="attempts/[attemptId]/submitted"
          options={{ ...page, headerBackVisible: false, title: 'Handed in' }}
        />
        <Stack.Screen name="attempts/[attemptId]/report" options={{ ...page, title: 'Report' }} />
        <Stack.Screen name="profile" options={{ ...page, title: 'Your details' }} />
        <Stack.Screen name="notifications" options={{ ...page, title: 'Notifications' }} />
      </Stack.Protected>
      <Stack.Protected guard={!identity}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
