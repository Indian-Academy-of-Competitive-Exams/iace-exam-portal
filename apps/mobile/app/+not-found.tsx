import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/ui/button';
import { EmptyState } from '../src/components/ui/empty-state';
import { LOGIN_ROUTE, ROUTES } from '../src/lib/nav';
import { useAuth } from '../src/providers/auth';

export default function NotFoundScreen() {
  const router = useRouter();
  const { identity } = useAuth();

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <EmptyState
        title="Page not found"
        action={
          <Button onPress={() => router.replace(identity ? ROUTES.HOME : LOGIN_ROUTE)}>
            {identity ? 'Go to Home' : 'Sign in'}
          </Button>
        }
      />
    </View>
  );
}
