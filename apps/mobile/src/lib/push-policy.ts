/** Shown while the app is open too: a student reading one screen is not told to look elsewhere. */
const WHILE_OPEN = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

/** A paper in progress is never covered; the notification still reaches the shade to read after. */
const WHILE_SITTING = { ...WHILE_OPEN, shouldShowBanner: false };

/** What a push may do: during a sitting it neither covers the paper, takes the phone off it, nor refetches the bell. */
export const pushPolicy = (sitting: boolean) => ({
  presentation: sitting ? WHILE_SITTING : WHILE_OPEN,
  tapOpensBell: !sitting,
  refreshesBell: !sitting,
});
