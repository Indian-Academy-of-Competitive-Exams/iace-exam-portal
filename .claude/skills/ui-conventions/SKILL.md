---
name: ui-conventions
description: The binding shared-code and UI-behaviour rules for this repo - where a component lives (packages/ui vs app-kit vs apps), the shape of a list screen, navigation, confirm dialogs, loading states, pagination and chips. Use before writing or changing ANY screen, component, form, table, dialog, filter or nav entry in apps/admin or apps/test, and before adding anything to packages/ui or packages/app-kit.
---

# UI conventions

Every bullet is a rule to follow, not background. Read `packages/ui/src/index.ts` — the component
inventory — before building any UI.

## Shared code

- **Check `packages/ui` and `packages/app-kit` before writing any UI.** Extend the shared component rather than writing a local variant.
- **A component belongs in `apps/` only if it names a domain concept** (`GroupPicker`, `DocumentCard`, `SuperAdminOnly`). If you can describe it without a domain noun, it goes in `packages/ui` the first time.
- **`packages/ui` is design and carries no domain knowledge** (`Pagination` takes page sizes as a prop). **`packages/app-kit/src` is DOM-free**; browser-only adapters go in `@iace/app-kit/browser`. **`packages/contracts`** holds types, schemas and the typed client.
- Apps own only their wiring: routes, nav, `STORAGE_KEYS`, `ROUTES`, login screen, dashboard.
- **Take design values from `packages/ui` tokens.** Never a raw hex or one-off spacing in a feature component.

## UI behaviour

- **Build the screen the way the app already builds that kind of screen. Deviate only for a reason you can state in one sentence.** Open two screens that already do this job before writing a third. A one-off costs the reader everything they learned on every other screen.
  - **List screen:** `TableFrame` with the `PageHeader` in `header`, filters in `toolbar`, `DataTable` + `Pagination` inside. Not a bare fragment, not a hand-rolled header above a card.
  - **Navigation:** every destination sits under a section in `NAV_ITEMS`. A lone top-level row is the deviation, not the shortcut. A section's sub-screens are nav children with their own routes — in-page `Tabs` are for views of ONE record (a question's languages), never for what the left menu should be listing.
  - Same rule for confirm dialogs, empty-state wording, badge vocabulary, date formatting and filter placement: one vocabulary per app, and it is whichever one is already there.
- **Confirm before anything that destroys, revokes, grants, or changes what somebody can do** — `ConfirmDialog`, never a chip in a row. Name the consequence, include the count (`studentCount`, `groupCount`). **A toggle confirms in both directions.** Confirm even when reversible if the effect is invisible from where it happens (retiring a branch).
  - Skip the dialog only when the screen already previews exactly what it would do (import commit).
  - Where per-click confirmation would be absurd, **batch the clicks**: hold the draft as a **diff against the server**, show the pending count where a collapsed section still shows it, confirm once listing every change, and drop the draft after a save whether it succeeded or failed.
- **Content waits use `Skeleton`; actions use `Spinner`/`LoadingState`.** Tables, lists, cards and forms have a known shape — draw and hold it. Spinners are for a button mid-request (`Button loading`), a save, a file being read. Never hand-roll `<Loader2 className="animate-spin" />`.
- **A list control never ends silently at its first page.** `PAGE_SIZE_MAX` stays 100; anything that can outgrow it uses `Combobox` + `useInfinitePages` with server-side search. Never a plain `<select>` over one capped request.
- **Variable chips in a table cell use `BadgeList`** — first one (or `max`), then a focusable `+N` whose tooltip lists the rest. Never put a value only in a tooltip; anything a decision depends on belongs on a detail screen or behind a filter.

## Design system

Tailwind + shadcn/ui, tokens in `packages/ui`. Brand primary `#B83939`; Cancel = neutral grey;
destructive = crimson `#BE123C`; charts use the colorblind-safe set, never brand red. Light + dark
via CSS variables. `docs/design/design-system.html` is the living style guide.
