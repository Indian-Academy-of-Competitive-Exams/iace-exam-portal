import { useCallback, useEffect, useReducer } from 'react';
import { AppState } from 'react-native';
import { type FullscreenHandle } from '@iace/app-kit';
import { FOCUS_EVENTS, FOCUS_START, focusAfter, isOnPaper, leavesPaper } from './focus-guard';

/** React Native's AppState, narrowed to what the guard needs so a caller can stand in for it. */
export interface AppStateSource {
  subscribe: (onBackground: () => void) => () => void;
}

export const appStateSource: AppStateSource = {
  subscribe: (onBackground) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (leavesPaper(state)) onBackground();
    });
    return () => subscription.remove();
  },
};

/** The mobile FullscreenHandle: backgrounding the app is leaving the paper. */
export function useAppFocus(source: AppStateSource): FullscreenHandle {
  const [state, dispatch] = useReducer(focusAfter, FOCUS_START);

  useEffect(() => source.subscribe(() => dispatch(FOCUS_EVENTS.BACKGROUND)), [source]);

  const enter = useCallback(async () => dispatch(FOCUS_EVENTS.ACKNOWLEDGE), []);
  const exit = useCallback(async () => undefined, []);

  return { isFullscreen: isOnPaper(state), isSupported: true, exits: state.exits, enter, exit };
}
