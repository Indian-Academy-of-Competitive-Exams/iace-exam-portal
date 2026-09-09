import { useCallback, useEffect, useRef } from 'react';
import { THEMES, useTheme, type Theme } from '@iace/ui';

/** Browsers drop backgrounds, so the dark set prints as pale ink on white: light goes on for the print. */
export function usePrint(): () => void {
  const { theme, setTheme } = useTheme();
  const before = useRef<Theme | null>(null);

  useEffect(() => {
    const restore = () => {
      if (before.current === null) return;
      setTheme(before.current);
      before.current = null;
    };
    window.addEventListener('afterprint', restore);
    return () => window.removeEventListener('afterprint', restore);
  }, [setTheme]);

  return useCallback(() => {
    before.current = theme;
    setTheme(THEMES.LIGHT);
    // The attribute lands on <html> in an effect, so the dialog waits a frame for the repaint.
    requestAnimationFrame(() => window.print());
  }, [theme, setTheme]);
}
