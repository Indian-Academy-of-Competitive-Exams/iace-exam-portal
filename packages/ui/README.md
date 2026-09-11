# @iace/ui — design system

The single source of truth for how the IACE apps look. Colors, typography, spacing, radii, elevation, and shared components live here — **feature code never defines these values itself.**

Foundation: **Tailwind CSS + shadcn/ui**, driven by CSS-variable tokens.

## Files

- `src/tokens.css` — every design token as CSS variables, light + dark. The one place values are defined.
- `tailwind.preset.js` — maps Tailwind color/radius/shadow names to those variables.
- `src/components/` — the shadcn-based primitives (Button, Input, Card, Tabs, Table, Badge, StatTile, QuestionPalette, …). _(added during scaffolding)_

## Usage in an app

**1. Import the tokens once**, at the app entry (`apps/*/src/main.tsx`):

```ts
import '@iace/ui/tokens.css';
```

**2. Extend the preset** in the app's `tailwind.config.js`:

```js
module.exports = {
  presets: [require('@iace/ui/tailwind.preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
```

**3. Use roles, never raw values:**

```tsx
<button className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md">Save test</button>
<button className="bg-secondary text-secondary-foreground rounded-md">Cancel</button>
<button className="bg-destructive text-destructive-foreground rounded-md">Delete</button>
```

## Rules

- **Cancel = `secondary` (neutral).** It's a dismissal, never red.
- **Destructive = `destructive` (crimson).** Delete / reject / un-approve — always with an icon + confirm.
- **Brand red (`primary`, `#BF0D10`) is for primary/brand only** — it must never out-shout destructive.
- **Charts use `series-1…8` in fixed order, never cycled.** Data leads with blue (`series-1`), never brand red.
- **Dark mode** = `data-theme="dark"` on `<html>`. Never hand-flip colors; the tokens handle it.
- Adding a value? Add a **token** here — don't hardcode it in a component.

## Theme toggle

```ts
document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
```

Reference: the living style guide at `docs/design/design-system.html`.
