import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, type Theme } from './theme-context';
import { STORAGE_KEYS, THEME_ATTRIBUTE, THEMES } from '../lib/constants';

function readInitialTheme(): Theme {
  // index.html already resolved this before first paint; mirror its decision.
  const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return attr === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    // The tokens do all the work — never hand-flip individual colours.
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((current) => (current === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK)),
    [],
  );

  const value = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
