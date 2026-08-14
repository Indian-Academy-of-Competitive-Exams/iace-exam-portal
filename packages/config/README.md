# @iace/config

Shared build/lint config for the monorepo. Nothing here is app-specific.

| File                     | Used by                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `tsconfig.base.json`     | everything — strict TS, `noUncheckedIndexedAccess`, ES2022  |
| `tsconfig.node.json`     | `apps/api` — CommonJS + decorator metadata for NestJS       |
| `tsconfig.react.json`    | `apps/test`, `apps/admin` — DOM libs, `react-jsx`, `noEmit` |
| `eslint.config.js`       | Node/library packages (flat config)                         |
| `eslint.react.config.js` | the two SPAs (adds react-hooks + react-refresh)             |

The last two are **governance** rather than style — they are the CI half of
`docs/03`, which is only a document until something enforces it:

| File                       | Enforces                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `eslint.no-dom.js`         | §3 — `app-kit`/`contracts` `src` may not touch `window`/`document`/storage |
| `eslint.api-boundaries.js` | §4 — `apps/api/src` modules reach a sibling only through its public entry  |

Consume by extending, never by copying:

```jsonc
// apps/api/tsconfig.json
{ "extends": "@iace/config/tsconfig.node.json" }
```

```js
// apps/test/eslint.config.js
import config from '@iace/config/eslint-react';
export default config;
```
