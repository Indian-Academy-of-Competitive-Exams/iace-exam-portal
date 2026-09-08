# Student portal — the design language

The rules the student portal (`apps/test`) is built to. `ui-conventions` is binding for
both portals and points here for the bullets where the two differ; everything structural
and editorial in that skill applies to `apps/test` unchanged.

The mockups this was written from are gone: they were a starting point, and a screenshot
of an early idea outlives its usefulness the day the screen ships. The rules below and
the pattern layer in `apps/test/src/components/ui/` are what the portal is built to.

Admin's language is `docs/design/design-system.html`. This one is not a second design
system — it is the same tokens composed differently.

## The principle

**Admin and student share the same tokens and diverge in design language.**

- **Shared, never forked:** `packages/ui/src/tokens.css` — every colour, the type ramp,
  spacing, shadows, radii. And the primitive atoms — `Button`, `Badge`, `Card`, `Input`,
  `Dialog`, `Skeleton` — live in `packages/ui` and both portals use them unchanged.
- **Divergent:** the composition layer — how those atoms are arranged into screens.
  `TableFrame` / `ListView` are the **admin** language, dense and data-first. The student
  portal has its own, below. **Divergence happens ONLY above the primitive layer.**

A change needing a new colour, spacing step, radius or shadow is a **token** change in
`packages/ui`, shared with admin — never a one-off hex in a student component.

## The rules, in real token names

Airy, task- and motivation-first, mobile-first. The opposite of admin density.

- **Type hierarchy is bold.** Page and hero titles use `--text-2xl` (28) / `--text-3xl`
  (36) with `--tracking-tight` and `--weight-bold`; section headings `--text-lg` (18)
  `--weight-semibold`; body `--text-base` (14). Use the top of the ramp with confidence.
- **Whitespace is generous.** `--gap-section` (40) between blocks, `--pad-card` (20)
  inside cards, `--gap-group` (16) between grouped items. Never `--pad-card-compact` or
  admin's cell density on a student screen.
- **Cards as-is.** The shared `Card` is already `rounded-xl border-border shadow-sm` — use
  it, do not restyle it. Larger surfaces may take `--radius-2xl`.
- **Brick is a sparing accent.** `--red-600` for one primary call to action, the active nav
  disc on `--red-100`, and at most one hero figure per screen — never a fill, never a
  default. Everything structural is neutral: `--foreground`, `--muted-foreground`,
  `--border`.
- **Charts stay blue-led** (`#2563eb`, `#0d9488`, `#b45309`, `#7c3aed`), never brick.
- **No new fonts.** Inter (`--font-sans`) and the ramp do all the work; Nunito is the brand
  mark only. A display face was tried in mock and rejected — it is not a token.
- **Hero moments, not flat lists.** Every primary screen earns one confident focal element
  — a greeting, a next-test card, a big percentile — before the supporting grid.

## Which frame per screen

Both frames are already in `packages/ui`; content shape chooses between them.

- **`PageFrame` — content on the background.** The default here: cards float on
  `--background` and the tint separates them. Home (locked), the dashboard, Performance,
  Tests, a test's pre-test page, and the result's Score card and Compare tabs.
- **`PanelFrame` — one contained `Card` surface.** For dense, single-body screens: the
  per-question report, the solution review list, the leaderboard table, and the
  list-heavy account screens. Sub-sections inside a panel divide with `border-border`
  hairlines — never a card inside a card.

**The chrome is the shipped `AppShell`, untouched.** The rail, the top bar and the IACE
`Brandmark` come from it; this language governs the content area inside the frame, not the
shell around it. The rail is nav icons only — the "i" square in the mockups is a
placeholder to ignore.

## The component vocabulary

The student pattern layer belongs in `apps/test/src/components/ui/` — with the web app
rather than in `packages/ui`, because the post-V1 React Native app will not reuse web
components. Each piece is thin: a shared atom plus the rules above, and no new tokens.

**Build a screen from that layer, never from bespoke markup.** The directory is the
inventory. This file does not list what goes in it: the pieces are still being built, and a
doc may only name what the source defines — `pnpm docs:check` enforces that.

## Guardrails

- **Tokens never fork.** A needed value is a `packages/ui` token, shared with admin.
- **Shared atoms stay shared** — compose `Button`/`Card`/`Badge`, never re-implement them.
- **Admin does not change** when the student language does.
- **The exam CBT screen is untouched** — it replicates the government paper faithfully
  (`docs/02-domain-rules.md` §7) and follows neither language.
- No raw hex, no new fonts, no card-in-a-card, brick sparing, charts blue-led, and
  no-narration copy — the existing lint rules enforce these.

## The mockups

Main (Home, on background), MainPanel (Home, contained), Tests, TestAbout, Result and
Performance. They are the target for **structure, proportion, hierarchy,
spacing rhythm and composition** — not code to copy.

Read them for intent, not values: match what sits where, the size relationships and the
whitespace rhythm, then map every value to a token above. Ignore three things in them —
the display font (build with Inter only), any raw hex (resolve to the nearest token), and
the "i" glyph in the rail. Main and MainPanel are the two Home treatments; **MainPanel** is
the cleaner, Inter-only, token-aligned one, and Home itself is locked to `PageFrame`.
