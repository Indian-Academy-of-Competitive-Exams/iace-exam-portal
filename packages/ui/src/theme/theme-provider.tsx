import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './theme-context';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, THEMES, type Theme } from './theme';

function readInitialTheme(): Theme {
  // index.html already resolved this before first paint; mirror its decision.
  const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return attr === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    // The tokens do all the work — never hand-flip individual colours.
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const choose = useCallback((next: Theme) => setTheme(next), []);
  const toggle = useCallback(
    () => setTheme((current) => (current === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK)),
    [],
  );

  const value = useMemo(() => ({ theme, toggle, setTheme: choose }), [theme, toggle, choose]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
