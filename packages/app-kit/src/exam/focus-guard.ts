/** Whether the candidate is looking at the paper, and how often they have left it. */
export interface FullscreenHandle {
  isFullscreen: boolean;
  /** False where the platform cannot tell; then nothing here is asked for. */
  isSupported: boolean;
  /** How many times the paper has been left since this sitting opened. */
  exits: number;
  enter: () => Promise<void>;
  /** Hands the screen back when the sitting is over; a caller that also counts exits must ignore its own. */
  exit: () => Promise<void>;
}
