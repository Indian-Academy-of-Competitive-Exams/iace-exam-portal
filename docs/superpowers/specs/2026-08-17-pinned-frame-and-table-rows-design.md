# Pinned page frame and table row treatment

**Date:** 2026-08-17
**Scope:** `packages/ui`, `packages/app-kit`, `apps/admin`
**Status:** approved, implementing

## Problem

Three faults, all on the list screens.

1. **The page scrolls, not the table.** A long list pushes the page heading, its action buttons and
   the whole filter bar off the top of the window. To change a filter after scrolling you have to
   scroll back up to reach it.
2. **The heading row highlights on hover.** `DataTable` renders its heading inside a `TableRow`, and
   `TableRow` carries `hover:bg-muted/50`. Nothing is clickable up there, so the highlight promises
   something that is not on offer.
3. **The hover fill is a flat full-height block** that runs into the rules above and below it, so the
   row reads as changing colour rather than as being pointed at.

## Decisions

Both taken against live mockups, kept in `.superpowers/brainstorm/` (gitignored).

- **Opt-in framing.** The shell becomes a fixed-height frame whose content region scrolls, so every
  existing route behaves as it does today. Only the table screens opt into a pinned layout. Rejected:
  pinning every route, which would mean re-checking twelve of them for clipped content; and
  `position: sticky` alone, which leaves the page-level scrollbar in place.
- **Hover is a full-width tint with rounded ends, inset a few pixels top and bottom.** Rejected: the
  same band inset horizontally as well, and dropping the rules so every row becomes a spaced rounded
  band, which costs vertical room on every row of a hundred.

## Design

### The shell frame

`packages/app-kit/browser/app-shell.tsx`. The root goes from `min-h-screen` to
`h-dvh overflow-hidden` as a flex column — `dvh` rather than `vh` so mobile browser chrome does not
crop the bottom of the frame.

The top bar stops being `sticky` and drops `backdrop-blur`: it is a flex-none row now, and nothing
scrolls beneath it to blur. The sidebar drops `sticky top-[calc(var(--control-h-lg)+var(--space-4))]`
and `h-[calc(100vh-4rem)]` for `h-full`, retiring two hand-tuned calcs that only existed to fake a
frame under document scroll.

The content wrapper keeps its current `mx-auto max-w-6xl px-5 py-8` and gains `overflow-y-auto`.
Every route therefore renders as it does today; it scrolls inside the wrapper rather than the
document. Nothing else needs auditing, which is the whole point of this shape.

### How a page opts out of that scroller

The wrapper carries `has-[[data-page-frame]]:` variants that turn it into
`flex flex-col overflow-hidden` with no bottom padding when a framed page is somewhere inside it. No
prop, no context, no change to any route. If `:has()` is ever unavailable the page simply scrolls as
it does now, which is the right way for this to fail.

The whole class string is exported from `packages/ui` as a single const and imported by the shell, so
the attribute name and the selector that matches it cannot drift apart. Tailwind still sees the
literal: the preset already scans `packages/*/{src,browser}`.

### `TableFrame`

New in `packages/ui` — it names no domain concept, so it does not belong in `apps/`.

```tsx
<TableFrame framed={!creating} header={<PageHeader … />} toolbar={<>banner + filters + fold</>}>
  <DataTable … />
</TableFrame>
```

Header pinned, toolbar pinned, the `Card` between them a filling flex column, the table body the only
thing that scrolls, pagination pinned below it. It sets `data-page-frame` and publishes a context that
`DataTable` reads to learn it should fill and scroll — so a screen opts in once instead of flagging
the page and the table separately.

`framed={!creating}` is what keeps the inline "Add a student" card usable: while that form is open the
page reverts to ordinary scrolling, because pinning a tall form would leave the table no height at
all. Five screens take this — students, groups, branches, admins, features. `permissions` has no
table and is left alone.

### Table

`packages/ui/src/components/ui/table.tsx` moves to `border-separate border-spacing-0`. This is not a
preference: a collapsed table drops the borders on a sticky heading row and refuses a radius on a row,
and both asks need it.

Row rules move off `<tr>`'s `border-b` and onto the cells as an inset `box-shadow`. A shadow rather
than a border because the hover inset needs the cell's own vertical border edges.

`TableRow` loses `hover:bg-muted/50`. The hover moves to `TableBody` as one
`[&>tr:hover>td]:bg-muted`, a selector that cannot reach a `thead` — which is the actual fix for the
highlighting heading row, rather than a second class that happens to override it.

The inset: every body cell carries a permanent `border-y-[3px] border-y-transparent` with `py`
reduced to match, plus `bg-clip-padding`, so the fill stops short of the row boundary and the row's
height is identical hovered or not. The first and last cell round their outer corners. `TableHead`
becomes `sticky top-0` on `bg-card`, matching the `Card` it sits in, with its own inset rule.

This relies on an inset shadow painting beneath a transparent border, so the rule stays visible below
the inset fill. To be confirmed in a browser, not assumed. If it does not hold, the fallback is a
background-gradient band on the cell: same result, no border involvement.

## Testing

`packages/ui`:

- The heading row carries no hover rule, and heading cells are sticky.
- `TableBody` owns the hover, scoped so it cannot match a heading row.
- `DataTable` fills and scrolls inside a `TableFrame`, and does not outside one.
- `TableFrame` sets `data-page-frame` only when `framed`.

`packages/app-kit`: the shell's content wrapper carries the shared class const from `@iace/ui`.

## Non-goals

- No change to the twelve non-table routes beyond scrolling inside the wrapper instead of the page.
- `permissions` keeps its card layout.
- The inline create cards stay inline. Turning them into dialogs would remove the need for `framed`,
  but that is a separate decision about those forms.
- No token changes.
