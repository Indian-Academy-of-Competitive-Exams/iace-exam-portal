import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { useAuth } from '../../src/providers/auth';
import { ROUTES } from '../../src/lib/nav';

/** Minimal today: a greeting and the way to Tests. The full dashboard is a later task. */
export default function HomeScreen() {
  const { identity } = useAuth();
  const firstName = identity?.fullName?.trim().split(/\s+/)[0] ?? 'there';

  return (
    <View className="flex-1 gap-6 bg-background px-5 pt-8">
      <Text className="text-3xl font-bold tracking-tight text-foreground">Hi, {firstName}</Text>

      <Card className="gap-3 p-5">
        <Text className="text-lg font-semibold text-foreground">Ready for a test?</Text>
        <Link href={ROUTES.TESTS} asChild>
          <Button>Browse tests</Button>
        </Link>
      </Card>
    </View>
  );
}
