import {
  BarChart3,
  Bookmark,
  ClipboardList,
  Home,
  User,
  type LucideIcon,
} from 'lucide-react-native';

/** Route paths for the tab shell — the tab layout's screen names and Home's CTA both read from here. */
export const ROUTES = {
  HOME: '/',
  TESTS: '/tests',
  PERFORMANCE: '/performance',
  SAVED: '/saved',
  ACCOUNT: '/account',
} as const;

/** app-kit's `NavItem` types `icon` for web `lucide-react`, which RN icons do not satisfy. */
export interface MobileNavItem {
  /** The file expo-router resolves under `app/(tabs)/` — `index` is Home. */
  name: string;
  to: (typeof ROUTES)[keyof typeof ROUTES];
  label: string;
  icon: LucideIcon;
}

export const MOBILE_NAV_ITEMS: readonly MobileNavItem[] = [
  { name: 'index', to: ROUTES.HOME, label: 'Home', icon: Home },
  { name: 'tests', to: ROUTES.TESTS, label: 'Tests', icon: ClipboardList },
  { name: 'performance', to: ROUTES.PERFORMANCE, label: 'Performance', icon: BarChart3 },
  { name: 'saved', to: ROUTES.SAVED, label: 'Saved', icon: Bookmark },
  { name: 'account', to: ROUTES.ACCOUNT, label: 'Account', icon: User },
];
