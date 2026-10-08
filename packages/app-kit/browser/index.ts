import { clientKindSchema } from '@iace/contracts';
import {
  createTokenStore,
  type KeyValueStorage,
  type SignOutReason,
  type SignOutSignal,
  type TokenStore,
} from '../src';

/** The web half of app-kit — the only place here that may touch the DOM; outside `src` because the DOM ban in `@iace/config/eslint-no-dom` is scoped to `src/**`. */

/** `localStorage`, narrowed to the three methods a token store uses. */
export const browserStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/** `sessionStorage`, narrowed the same way: one per tab, surviving a reload of it. */
export const browserSessionStorage: KeyValueStorage = {
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => sessionStorage.removeItem(key),
};

/** Broadcast when a refresh fails, so the auth context can drop the session. */
export const SIGNED_OUT_EVENT = 'iace:signed-out';

/** A window event: the API client that raises it has no reference to the React tree. */
export const browserSignOutSignal: SignOutSignal = {
  emit: (reason) => window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: reason })),
  subscribe: (handler) => {
    const listener = (event: Event) =>
      handler((event as CustomEvent<SignOutReason | undefined>).detail);
    window.addEventListener(SIGNED_OUT_EVENT, listener);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, listener);
  },
};

/** The token store every web SPA wants, with only its storage key to choose. */
export function createBrowserTokenStore(storageKey: string): TokenStore {
  const held = createTokenStore(storageKey, browserStorage);
  const reasonKey = `${storageKey}.ended`;

  return {
    ...held,
    set: (tokens) => {
      held.set(tokens);
      browserStorage.removeItem(reasonKey);
    },
    // The reason is written first: another tab reads it the moment it hears the token go.
    clear: (reason) => {
      try {
        if (reason) browserStorage.setItem(reasonKey, reason.replacedBy ?? '');
      } catch {
        // A storage that will not take the reason must still let go of the token.
      }
      held.clear();
    },
    endedBy: () => {
      try {
        const kind = browserStorage.getItem(reasonKey);
        return kind === null ? null : { replacedBy: clientKindSchema.safeParse(kind).data ?? null };
      } catch {
        return null;
      }
    },
    // The storage event reaches every tab but the one that wrote; a null key is the whole storage cleared.
    subscribe: (onChange) => {
      const listener = (event: StorageEvent) => {
        if (event.key === null || event.key === storageKey) onChange();
      };
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
  };
}

// --- the web app scaffolding: composes @iace/ui and react-router-dom, hence not in `src/` ------
export { AppShell, type AppShellProps, type NavItem, type ShellWidth } from './app-shell';
export { useWorkspace } from './app-shell/use-workspace';
export { mountApp } from './mount-app';
export { PageCrumbs } from './page-crumbs';
export {
  CohortFigure,
  MarksFigure,
  type Benchmark,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from './performance-figures';
export {
  DispositionFigure,
  MeasureTiles,
  ScopeGapFigure,
  ScoreTrendFigure,
  SpeedAccuracyFigure,
  SubjectStrengthFigure,
  TimeReturnFigure,
  WeakestSubjectsFigure,
  type SubjectView,
} from './overview-figures';
export { StreakFigure } from './streak-figure';
export { ProtectedRoute } from './protected-route';
export { useFilters } from './use-filters';
export { useFullscreen, type FullscreenHandle } from './use-fullscreen';
export { useLeaveGuard } from './use-leave-guard';
export { useMediaQuery, DESKTOP_QUERY } from './app-shell/use-media-query';
export { useFilterSpec, type FilterSpecState, type ListValues } from './use-filter-spec';
export { saveBlob } from './save-blob';
export { printElement, printHtml } from './print-html';
export { ReportTableView } from './report-table';
export { useImportScreen, type ImportScreenState, type ImportTemplate } from './use-import-screen';
export { useListScreen } from './use-list-screen';
export { useScrollList } from './use-scroll-list';
export { useLocalFilters, type FilterStore } from './use-local-filters';
export { shrunkForUpload, worthEncoding, drawnSize, webpName } from './shrink-image';
export { TourProvider, TourTrigger, usePageTour } from './page-tour';
