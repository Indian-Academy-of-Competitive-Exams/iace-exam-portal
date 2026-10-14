import { colorScheme } from 'nativewind';
import { STORAGE_KEYS } from './constants';
import { sittingStorage } from './sitting-store';

export const THEMES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' } as const;
export type Theme = (typeof THEMES)[keyof typeof THEMES];

const isTheme = (held: string | null): held is Theme =>
  Object.values(THEMES).includes(held as Theme);

export const savedTheme = (): Theme => {
  const held = sittingStorage.getItem(STORAGE_KEYS.THEME);
  return isTheme(held) ? held : THEMES.SYSTEM;
};

/** Overrides the phone's setting app-wide, so `dark:` classes and `useColorScheme` both follow it. */
export function applyTheme(theme: Theme): void {
  colorScheme.set(theme);
}

export function chooseTheme(theme: Theme): void {
  sittingStorage.setItem(STORAGE_KEYS.THEME, theme);
  applyTheme(theme);
}
