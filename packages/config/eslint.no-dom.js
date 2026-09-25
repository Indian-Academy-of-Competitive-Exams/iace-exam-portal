// The portability rule from docs/03 §3, made mechanical.
//
// `app-kit` and `contracts` are the tier Expo reuses verbatim, so the DOM is
// refused at the door — each capability is an INJECTED ADAPTER instead (see TokenStore).
// Scope is `src/**`: `app-kit/browser` holds the web adapters and sits outside it.
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
      // Catches a bare reference whether or not the global is declared by `globals` (unresolved references are checked too), so this fires in React- and Node-flavoured packages alike.
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({ name, message: MESSAGE })),
      ],

      // ...and closes the obvious way around it: `globalThis.localStorage` is the same dependency wearing a hat.
      'no-restricted-properties': [
        'error',
        ...DOM_GLOBALS.map((property) => ({ object: 'globalThis', property, message: MESSAGE })),
      ],
    },
  },
]);
