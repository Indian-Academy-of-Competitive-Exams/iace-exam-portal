// The portability rule from docs/03 §3, made mechanical.
//
// `app-kit` and `contracts` are the tier Expo reuses verbatim, so the DOM is
// refused at the door — each capability is an INJECTED ADAPTER instead (see TokenStore).
// Scope is `src/**`: `app-kit/browser` holds the web adapters and sits outside it.
// `packages/ui` is not covered at all — it is web-only by design.
import { defineConfig } from 'eslint/config';

/** The four that actually appear in SPA plumbing. */
const DOM_GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage'];

/** Web-only packages, subpaths and all: a bare `fetch` is cross-runtime, `@iace/ui` is not. */
const WEB_ONLY = [
  '@iace/ui',
  '@iace/ui/*',
  'react-dom',
  'react-dom/*',
  'react-router-dom',
  'react-router-dom/*',
];

const MESSAGE =
  'This package must stay DOM-free so mobile can reuse it (docs/03 §3). ' +
  'Take the capability as an injected adapter instead — see TokenStore.';

const IMPORT_MESSAGE =
  'This package must stay DOM-free so mobile can reuse it (docs/03 §3). ' +
  'A web-only import belongs in `app-kit/browser`, which sits outside this rule.';

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

      // ...and the rest of the way around it: a web-only module imported here is the DOM arriving by name.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: WEB_ONLY, message: IMPORT_MESSAGE }] },
      ],
    },
  },
]);
