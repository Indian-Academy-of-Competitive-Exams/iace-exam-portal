import { AppState } from 'react-native';
import { type FullscreenHandle } from '@iace/app-kit';

const APP_STATE_BACKGROUND = 'background' as const;

const nothingToDo = async () => undefined;

/** The mobile FullscreenHandle: a phone has no full screen to re-enter, so only `fullscreen.ignore` clears the nag. */
export const appFocus = (exits: number): FullscreenHandle => ({
  isFullscreen: false,
  isSupported: true,
  exits,
  enter: nothingToDo,
  exit: nothingToDo,
});

/** Only going to the background leaves the paper; coming back, or iOS's brief inactive, does not. */
export function onBackground(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === APP_STATE_BACKGROUND) listener();
  });
  return () => subscription.remove();
}
