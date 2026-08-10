# @iace/config

Shared build/lint config for the monorepo. Nothing here is app-specific.

| File | Used by |
|---|---|
| `tsconfig.base.json` | everything — strict TS, `noUncheckedIndexedAccess`, ES2022 |
| `tsconfig.node.json` | `apps/api` — CommonJS + decorator metadata for NestJS |
| `tsconfig.react.json` | `apps/student`, `apps/admin` — DOM libs, `react-jsx`, `noEmit` |
| `eslint.config.js` | Node/library packages (flat config) |
| `eslint.react.config.js` | the two SPAs (adds react-hooks + react-refresh) |

Consume by extending, never by copying:

```jsonc
// apps/api/tsconfig.json
{ "extends": "@iace/config/tsconfig.node.json" }
```

```js
// apps/student/eslint.config.js
import config from '@iace/config/eslint-react';
export default config;
```
