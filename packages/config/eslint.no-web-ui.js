// The portability rule from docs/03 §3, read from the mobile side.
//
// packages/ui is Tailwind and Radix against the DOM, and app-kit/browser is the
// web adapter tier. Neither can run in React Native. An import of either is not
// a lint nit: it builds fine until Metro resolves it, and the failure reads as a
// bundler problem rather than a boundary one. So it is refused at the door.
import { defineConfig } from 'eslint/config';

const WEB_ONLY = ['@iace/ui', '@iace/app-kit/browser'];

const MESSAGE =
  'This package is web-only and React Native cannot run it (docs/03 §3). ' +
  "Use @iace/app-kit for portable logic, and this app's own components for UI.";

export default defineConfig([
  {
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: WEB_ONLY.map((group) => ({ group: [group, `${group}/*`], message: MESSAGE })) },
      ],
    },
  },
]);
