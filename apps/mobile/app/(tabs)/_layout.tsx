import { Tabs } from 'expo-router';
import { type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type LucideIcon } from 'lucide-react-native';
import { MOBILE_NAV_ITEMS } from '../../src/lib/nav';
import { useTokenColor } from '../../src/lib/use-token-color';

/** A stable render-prop per icon, rather than a component defined inline on every render. */
const renderTabIcon =
  (Icon: LucideIcon) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Icon color={color} size={size} />;

/** The five-tab shell every signed-in screen lives under. */
export default function TabLayout() {
  const activeColor = useTokenColor('--primary');
  const inactiveColor = useTokenColor('--muted-foreground');
  const barColor = useTokenColor('--surface');
  const borderColor = useTokenColor('--border');
  const pageColor = useTokenColor('--background');
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // No header to hold the status bar's space, so the scene holds it: nothing draws under the notch.
        sceneStyle: { paddingTop: insets.top, backgroundColor: pageColor },
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
