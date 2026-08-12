/**
 * Which token set is live.
 *
 * These belong to the design system rather than to an app: `data-theme` is the
 * attribute `tokens.css` keys off, and an app that spelled it differently would
 * simply render the wrong palette. The theme is shared across the SPAs on
 * purpose — one person, one origin, one choice — so the storage key is a
 * constant here rather than a per-app parameter.
 *
 * NOTE: each app's index.html applies the stored theme before first paint, so
 * it repeats these as literals — it runs before any bundle exists. Change one,
 * change the other.
 */
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

/** The attribute the design-system tokens key off, on <html>. */
export const THEME_ATTRIBUTE = 'data-theme';

export const THEME_STORAGE_KEY = 'iace.theme';
