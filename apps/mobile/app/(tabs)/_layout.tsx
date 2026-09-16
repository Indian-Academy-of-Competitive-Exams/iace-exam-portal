import { Tabs } from 'expo-router';
import { type ColorValue } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { type LucideIcon } from 'lucide-react-native';
import { MOBILE_NAV_ITEMS } from '../../src/lib/nav';

const asColor = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** A stable render-prop per icon, rather than a component defined inline on every render. */
const renderTabIcon =
  (Icon: LucideIcon) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Icon color={color} size={size} />;

/** The five-tab shell every signed-in screen lives under. */
export default function TabLayout() {
  const activeColor = asColor(useUnstableNativeVariable('--primary'));
  const inactiveColor = asColor(useUnstableNativeVariable('--muted-foreground'));
  const barColor = asColor(useUnstableNativeVariable('--surface'));
  const borderColor = asColor(useUnstableNativeVariable('--border'));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: { backgroundColor: barColor, borderTopColor: borderColor },
      }}
    >
      {MOBILE_NAV_ITEMS.map(({ name, label, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarIcon: renderTabIcon(Icon),
          }}
        />
      ))}
    </Tabs>
  );
}
