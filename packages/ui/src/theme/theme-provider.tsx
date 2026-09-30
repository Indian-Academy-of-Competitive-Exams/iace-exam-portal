import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './theme-context';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, THEMES, type Theme } from './theme';

const DARK_SCHEME = '(prefers-color-scheme: dark)';

function readInitialTheme(): Theme {
  // index.html already resolved this before first paint; mirror its decision.
  const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return attr === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

/** Whether the reader has picked a theme themselves. Until they do the device owns it. */
function chosen(): boolean {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === THEMES.DARK || stored === THEMES.LIGHT;
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [picked, setPicked] = useState<boolean>(chosen);

  useEffect(() => {
    // The tokens do all the work — never hand-flip individual colours.
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  }, [theme]);

  // Storing the RESOLVED theme would freeze index.html's fallback, so the device is followed until a toggle stores one.
  useEffect(() => {
    if (picked) return;
    const scheme = window.matchMedia(DARK_SCHEME);
    const follow = () => setTheme(scheme.matches ? THEMES.DARK : THEMES.LIGHT);
    follow();
    scheme.addEventListener('change', follow);
    return () => scheme.removeEventListener('change', follow);
  }, [picked]);

  const toggle = useCallback(() => {
    const next = theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
    setPicked(true);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
