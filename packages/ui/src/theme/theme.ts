/**
 * Which token set is live. `data-theme` is what tokens.css keys off.
 * Each app's index.html repeats these as literals — it runs before any bundle.
 */
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

/** The attribute the design-system tokens key off, on <html>. */
export const THEME_ATTRIBUTE = 'data-theme';

export const THEME_STORAGE_KEY = 'iace.theme';
