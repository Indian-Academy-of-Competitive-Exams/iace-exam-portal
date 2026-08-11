import { createContext, use } from 'react';
import { type THEMES } from '../lib/constants';

export type Theme = (typeof THEMES)[keyof typeof THEMES];

export interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

/** Context + hook live apart from the provider component so editing the
 *  provider hot-reloads instead of forcing a full page refresh. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
