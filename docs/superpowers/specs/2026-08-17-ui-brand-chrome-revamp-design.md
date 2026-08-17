# UI brand and chrome revamp

**Date:** 2026-08-17
**Scope:** `packages/ui`, `packages/app-kit`, `apps/admin`, `apps/test`
**Status:** approved, awaiting implementation plan

## Problem

The signed-in chrome and the two login screens undersell the product in four separate ways.

1. `Brandmark` renders the string `IA` inside its brand-red tile. The institute is IACE. A truncation
   nobody asked for reads as a bug in the logo.
2. The portal name sits beside the wordmark as plain 13px body text at medium weight. It competes
   with the brand for the same glance instead of labelling it.
3. Both login screens keep the lockup in a page header and leave the card itself unbranded — the one
   element the reader is actually looking at carries no identity.
4. The admin and student landing screens are filled with cards that state what is not built yet.
   The admin sidebar additionally spends a row on `Overview` and the student sidebar spends its only
   row on `Home`, when the lockup could do that job in both.

## Decisions

Four choices were made against rendered mockups (kept in `.superpowers/brainstorm/`, gitignored).

- **Lockup:** the full word `IACE` set in white bold on a brand-red plate, with the portal name
  beside it as a micro-caps label. Rejected: a wordmark with a red accent bar and no plate; a red
  tile carrying a drawn ascending-bars mark. The plate is the loudest and least ambiguous of the
  three, at the cost of having no square form to reuse as an icon.
- **Login:** the plate centred at the top of the card, and the per-step icon dropped. Rejected:
  plate above the step icon (two marks competing inside 60px); plate in a tinted topper strip.
- **Sidebar:** the two admin sections stay collapsed behind popovers. Rejected: flattening them into
  labelled groups of visible leaves, which reads better today but stops scaling the moment the
  question bank and test screens land.
- **Landing screens:** header only, no filler.

## Design

### Brandmark

`packages/ui/src/components/ui/brandmark.tsx`. The component renders a plate — `bg-primary`,
`rounded-md`, matching the radius every other control uses — holding `IACE` in `primary-foreground`,
`text-sm font-extrabold tracking-wide`. Bold letters set tight read as a single blot at this size,
so the tracking is doing real work rather than styling. Colour and radius come from the tokens
through the Tailwind preset; the type scale is Tailwind's own, as it is everywhere else in
`packages/ui` — the preset extends colours, radii and shadows, not `fontSize`.

`withWordmark` is deleted. The word is now always inside the plate, so the prop has nothing left to
select. A new `portal?: string` renders after the plate as `text-xs font-semibold uppercase
tracking-wide text-muted-foreground` — the same micro-caps the sidebar already uses for its section
labels. Absent by default, so the component stays usable anywhere a bare mark is wanted.

The `sr-only` fallback goes with it — the plate holds real text and reads without help.

The component stays a `div` and never links anywhere. Wrapping it is the caller's job, which keeps
`packages/ui` free of routing.

### Shell

`packages/app-kit/browser/app-shell.tsx`.

- The header lockup is wrapped in a `Link`. A new `homeTo` prop, defaulting to `/`, names the target;
  both apps pass `ROUTES.HOME`. This is the entire replacement for the Overview and Home nav rows.
- A new `portal` prop is threaded to `Brandmark`. `brandSuffix` stays but narrows to one job: the
  admin's Super admin badge.
- **`UserMenu` moves from the foot of the sidebar into the header**, beside `ThemeToggle`. This is
  forced rather than chosen: the student sidebar is about to become empty, and the account menu
  cannot go with it. The side effect is welcome — the sidebar becomes nav and nothing else.
- When `items` is empty, no `<aside>` renders on desktop and neither the hamburger nor the `Sheet`
  renders on mobile. The student app's pages run full width instead of sitting beside an empty
  column.
- The collapse toggle stays, because the admin still has nav to collapse. The `mt-8` clearance on
  `<nav>` stays with it for the same reason.
- The sidebar's `<aside aria-label="Sections">` becomes a plain `<div>`, and the `<nav>` inside it
  takes the label. The aside wrapped nothing but that nav, so it announced the same region twice —
  once as a complementary landmark and once as a navigation one.
- The mobile drawer keeps the lockup, which is also a link home, and no longer duplicates the user
  menu now that the header owns it.

### Navigation

`apps/admin/src/lib/constants.ts` drops the `Overview` leaf and its `LayoutDashboard` import.
`apps/test/src/lib/constants.ts` drops the `Home` leaf and its `Home` import, leaving `NAV_ITEMS`
empty. `ROUTES.HOME` stays in both — it is what the lockup points at.

### Login screens

`apps/admin/src/routes/login.tsx` and `apps/test/src/routes/login.tsx`.

- The page header is deleted. `ThemeToggle` is absolutely positioned at the page's top right rather
  than sitting in a bar built to hold one control.
- Each card opens with the plate, centred. The admin card adds `Admin portal` beneath it; the student
  card adds nothing, matching its shell header, which carries no portal label either.
- `StepIcon` is removed from all six step headers. The component and its tests stay in
  `packages/ui` — the three-step test-creation wizard in the build order needs it.
- Card title and description centre. Form fields stay left-aligned; a centred label over a
  left-aligned input reads as a mistake.
- Two orphaned doc comments are deleted, at `apps/admin/src/routes/login.tsx:217` and
  `apps/test/src/routes/login.tsx:413`. Both describe a step-icon helper that no longer follows them.

### Landing screens

`apps/admin/src/routes/dashboard.tsx` keeps its `PageHeader` and nothing else. The "Where to start"
card goes; so does "Signed in as", whose email already appears in the user menu.

`apps/test/src/routes/dashboard.tsx` keeps the avatar `PageHeader` and `PreTestPrompt` — the prompt
is functional, not filler. The "Your tests will appear here" card and its profile button go.

## Testing

Extended in place, in `packages/ui/test/primitives.dom.test.tsx` and the app-kit shell tests:

- The plate renders the string `IACE`. This is the regression guard for the original defect and the
  one assertion that must never be relaxed.
- `portal` renders its label when given, and nothing when omitted.
- `nav={[]}` renders no navigation landmark and no drawer trigger.
- The lockup is a link, and it points at `homeTo`.

`packages/app-kit` had no DOM tests, so this adds the plumbing for them: `@testing-library/react`,
plus `react-router-dom` and `lucide-react` as dev dependencies, since both were peers only and a test
cannot render the shell without them. The jsdom harness is reused rather than copied —
`packages/ui` exports it as `@iace/ui/test-support/dom`.

Two tsconfig `include` lists are corrected along the way. `packages/app-kit/tsconfig.json` never
listed `browser/**/*.tsx`, so the shell — the largest file in the package — had never been
typechecked, and tsx fell back to the classic JSX transform for it. The test tsconfig additionally
lists `@iace/ui`'s source, because tsx resolves one tsconfig per run and a `.tsx` file it does not
match renders as "React is not defined".

A test that renders the shell must pin the viewport: jsdom's `matchMedia` always reports no match, and
the shell renders a different component per breakpoint rather than one styled twice, so an unpinned
test silently exercises the mobile tree.

## Non-goals

- **Favicon and app icon.** The chosen lockup is a wide plate with no square form, so an icon needs a
  mark that does not exist yet. That is its own decision, not a detail of this one.
- **No sweep over the seven built screens** — students, student detail, groups, branches, admins,
  features, permissions — nor over the student profile screens. Their tables and forms are untouched.
- **Tokens are untouched.** No change to the type scale, palette, radii or the CBT exam colours.
