import { Moon, Sun } from 'lucide-react';
import { Button } from '@iace/ui';
import { THEMES } from '../lib/constants';
import { useTheme } from '../providers/theme-context';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === THEMES.DARK ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === THEMES.DARK ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
