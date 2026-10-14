import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type LucideIcon } from 'lucide-react-native';
import { MOBILE_NAV_ITEMS } from '../../src/lib/nav';
import { cn } from '../../src/lib/cn';
import { useTokenColor } from '../../src/lib/use-token-color';

/** Above the navigator's 25, since the icon now stands alone; the title stays as its spoken name. */
const TAB_ICON_SIZE = 28;

/** The pill's box, given to the navigator's icon slot too, which is otherwise 31 by 28 and would cut it. */
const PILL = { width: 64, height: 36 } as const;

/** The tab you are on wears a pill drawn here: the navigator's own active fill is square. */
const renderTabIcon =
  (Icon: LucideIcon) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <View
      style={PILL}
      className={cn('items-center justify-center rounded-full', focused && 'bg-primary-subtle')}
    >
      <Icon color={color} size={TAB_ICON_SIZE} />
    </View>
  );

/** The navigator's own default. Standing the pill off the divider means growing the bar by as much. */
const UIKIT_BAR_HEIGHT = 49;
const BAR_HEIGHT = UIKIT_BAR_HEIGHT + 8;

/** The tab shell every signed-in screen lives under. */
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
        tabBarShowLabel: false,
        tabBarIconStyle: PILL,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: {
          backgroundColor: barColor,
          borderTopColor: borderColor,
          height: BAR_HEIGHT + insets.bottom,
        },
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
