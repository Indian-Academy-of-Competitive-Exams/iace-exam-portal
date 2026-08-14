// The portability rule from docs/03 §3, made mechanical.
//
// `packages/app-kit` and `packages/contracts` are the tier a React Native app
// reuses verbatim. One `localStorage.getItem` in there is not a lint nit — it
// is the line between "Expo imports this package" and "Expo forks it", and it
// is invisible until the day someone tries. So the DOM is refused at the door
// and the seam is an INJECTED ADAPTER: the browser passes in a localStorage
// token store and a window-event emitter, Expo passes in SecureStore and its
// own emitter, and the package itself knows about neither.
//
// The scope is `src/**` on purpose, and it is load-bearing: `app-kit/browser`
// holds the web adapters and is deliberately outside it, so the boundary
// between the portable tier and the web tier is a directory you can see rather
// than a convention you have to know.
//
// `packages/ui` is not covered at all — it is web-only by design.
import { defineConfig } from 'eslint/config';

/** The four that actually appear in SPA plumbing. */
const DOM_GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage'];

const MESSAGE =
  'This package must stay DOM-free so mobile can reuse it (docs/03 §3). ' +
  'Take the capability as an injected adapter instead — see TokenStore.';

export default defineConfig([
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Catches a bare reference whether or not the global is declared by the
      // config's `globals` (unresolved references are checked too), so this
      // fires in the React-flavoured and Node-flavoured packages alike.
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({ name, message: MESSAGE })),
      ],

      // ...and closes the obvious way around it. `globalThis.localStorage` is
      // the same dependency wearing a hat.
      'no-restricted-properties': [
        'error',
        ...DOM_GLOBALS.map((property) => ({ object: 'globalThis', property, message: MESSAGE })),
      ],
    },
  },
]);
