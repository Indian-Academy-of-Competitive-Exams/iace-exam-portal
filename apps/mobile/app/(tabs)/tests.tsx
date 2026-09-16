import { View } from 'react-native';
import { EmptyState } from '../../src/components/ui/empty-state';

export default function TestsScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <EmptyState title="Coming soon" />
    </View>
  );
}
