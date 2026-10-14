import { Tabs } from 'expo-router';
import { type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type LucideIcon } from 'lucide-react-native';
import { MOBILE_NAV_ITEMS } from '../../src/lib/nav';
import { useTokenColor } from '../../src/lib/use-token-color';

/** Above the navigator's 25, since the icon now stands alone; the title stays as its spoken name. */
const TAB_ICON_SIZE = 28;

/** A stable render-prop per icon, rather than a component defined inline on every render. */
const renderTabIcon =
  (Icon: LucideIcon) =>
  ({ color }: { color: ColorValue }) => <Icon color={color} size={TAB_ICON_SIZE} />;

/** The tab you are on wears a pill; the bar draws that fill square, so the item clips it round. */
const ITEM_STYLE = {
  borderRadius: 16,
  overflow: 'hidden',
  marginHorizontal: 6,
  marginVertical: 4,
} as const;

/** The navigator's own default. Standing the pill off the divider means growing the bar by as much. */
const UIKIT_BAR_HEIGHT = 49;
const BAR_HEIGHT = UIKIT_BAR_HEIGHT + 8;

/** The tab shell every signed-in screen lives under. */
export default function TabLayout() {
  const activeColor = useTokenColor('--primary');
  const inactiveColor = useTokenColor('--muted-foreground');
  const barColor = useTokenColor('--surface');
  const heldColor = useTokenColor('--primary-subtle');
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
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarActiveBackgroundColor: heldColor,
        tabBarItemStyle: ITEM_STYLE,
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
