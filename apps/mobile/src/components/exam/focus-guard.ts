/** What the paper knows about the student leaving it: how often, and how many of those they have seen. */
export interface FocusState {
  exits: number;
  acknowledged: number;
}

export const FOCUS_EVENTS = {
  BACKGROUND: 'BACKGROUND',
  ACKNOWLEDGE: 'ACKNOWLEDGE',
} as const;
export type FocusEvent = (typeof FOCUS_EVENTS)[keyof typeof FOCUS_EVENTS];

export const FOCUS_START: FocusState = { exits: 0, acknowledged: 0 };

const APP_STATE_BACKGROUND = 'background' as const;

export function focusAfter(state: FocusState, event: FocusEvent): FocusState {
  if (event === FOCUS_EVENTS.BACKGROUND) return { ...state, exits: state.exits + 1 };
  return { ...state, acknowledged: state.exits };
}

/** Only going to the background leaves the paper; coming back, or iOS's brief inactive, does not. */
export const leavesPaper = (appState: string): boolean => appState === APP_STATE_BACKGROUND;

/** On the paper only once every exit has been acknowledged; coming back alone is not enough. */
export const isOnPaper = (state: FocusState): boolean => state.exits === state.acknowledged;
