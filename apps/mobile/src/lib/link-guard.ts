const OWN_LINK = /^iace-mobile:\/\/\/*/;
const ROOT_PATH = '/';

/** Outside React: the system hands a link over before any screen has mounted, and a paper must not wait for a render. */
export function createLinkGuard() {
  let sitting = false;
  let signedIn = false;
  let signedOutShown = false;
  let turnedAway: string | null = null;

  return {
    setSitting: (on: boolean) => {
      sitting = on;
    },

    isSitting: () => sitting,

    /** What the router is told about a link from outside the app: null leaves the phone where it is. */
    admit: (url: string): string | null => {
      if (sitting) return null;
      const path = OWN_LINK.test(url) ? url.replace(OWN_LINK, ROOT_PATH) : null;
      if (!signedIn && path !== null && path !== ROOT_PATH) turnedAway = path;
      return url;
    },

    /** The link to open now the session is known: one the sign-in screen turned away, never one the router already opened. */
    settle: (isSignedIn: boolean): string | null => {
      const replay = isSignedIn && signedOutShown ? turnedAway : null;
      if (isSignedIn) turnedAway = null;
      signedOutShown = !isSignedIn;
      signedIn = isSignedIn;
      return replay;
    },
  };
}

export const linkGuard = createLinkGuard();
