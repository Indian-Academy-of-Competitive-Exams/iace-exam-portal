---
name: ui-conventions
description: The binding shared-code and UI-behaviour rules for this repo - where a component lives (packages/ui vs app-kit vs apps), the shape of a list screen, navigation, confirm dialogs, loading states, pagination and chips. Use before writing or changing ANY screen, component, form, table, dialog, filter or nav entry in apps/admin or apps/test, and before adding anything to packages/ui or packages/app-kit.
---

# UI conventions

Every bullet is a rule, not background. **They are binding: no deviations.** Where a bullet allows
a judgement it says so, and then the judgement is one sentence you write down — not a silent
choice. Read `packages/ui/src/index.ts` — the component inventory — before building any UI.

Existing code that breaks a rule is named in the bullet that breaks it. Those are the shapes to
stop copying, not licence to add another.

## Shared code

- **Check `packages/ui` and `packages/app-kit` before writing any UI.** Extend the shared component rather than writing a local variant.
- **A component belongs in `apps/` only if it names a domain concept** (`GroupPicker`, `DocumentCard`, `SuperAdminOnly`). If you can describe it without a domain noun, it goes in `packages/ui` the first time.
- **`packages/ui` is design and carries no domain knowledge** (`Pagination` takes page sizes as a prop). **`packages/app-kit/src` is DOM-free**; browser-only adapters go in `@iace/app-kit/browser`. **`packages/contracts`** holds types, schemas and the typed client.
- Apps own only their wiring: routes, nav, `STORAGE_KEYS`, `ROUTES`, login screen, dashboard.
- **Take design values from `packages/ui` tokens.** Never a raw hex or one-off spacing in a feature component.

## UI behaviour

- **Build the screen the way the app already builds that kind of screen. Deviate only for a reason you can state in one sentence.** Open two screens that already do this job before writing a third. A one-off costs the reader everything they learned on every other screen.
  - **List screen:** `TableFrame` with the `PageHeader` in `header`, filters in `toolbar`, `DataTable` + `Pagination` inside. Not a bare fragment, not a hand-rolled header above a card.
  - **Creating or editing ONE entity is a `FormDialog`,** never a card pushed into the page above the table. Pass it the whole `form` — it resets on close, which a mounted dialog will not do by itself. An edit dialog is mounted only while a row is being edited and keyed by that row's id, or it opens showing the previous row's values.
  - **Navigation:** every destination sits under a section in `NAV_ITEMS`. A lone top-level row is the deviation, not the shortcut. A section's sub-screens are nav children with their own routes — in-page `Tabs` are for views of ONE record (a question's languages), never for what the left menu should be listing.
  - **The nav never takes space from the page.** The icon rail is the resting state and the only nav in the layout flow; its width is fixed, so the content region is a constant. Opening the nav opens a portalled `Sheet` OVER the page, transient — it closes on navigate, Escape and click-outside. Never widen a flex sibling of `<main>`: that reflows every screen to show a menu. In the panel a section drops open in place, one at a time; the rail, and a section past `NAV_INLINE_MAX_ITEMS`, open a popover beside the row instead. **On touch the panel drills down** — one level at a time with a way back, and never a popover, which over a sheet is a modal over a modal.
  - Same rule for confirm dialogs, empty-state wording, badge vocabulary, date formatting and filter placement: one vocabulary per app, and it is whichever one is already there.
- **A header that carries actions never scrolls away. Pin the header, scroll only the body.** Not a list-screen trick — it applies to any page whose `PageHeader` holds an action (New, Save, Import, Sync) or a static description. A Save button that scrolls off the top is a button the user has to go hunting for.
  - **Reach for the frame, don't rebuild it.** `TableFrame` for a list, `PageFrame` for everything else — a detail screen, a form, an importer. Both mark themselves `data-page-frame`, which flips the shell's `PAGE_CONTENT_CLASS` from `overflow-y-auto` to `overflow-hidden` via `:has()`, and both hold the header at `shrink-0`. `TableFrame` then makes the table the scroller so filters and pagination stay put too; `PageFrame` makes its body the scroller. A hand-rolled sticky header is the deviation.
  - **One scrollport per page, and one per section. Never two nested.** A scrollbar inside a scrollbar strands content between them: the outer one looks finished while the inner still has rows. Inside a frame the body scrolls and nothing within it takes its own `overflow-y-auto`; a tall child gets `min-h-0` so it can shrink instead. Popovers are portalled and do not count. A dialog is its own page for this purpose — `DialogBody` scrolls, the wrapper does not, and `dialog.dom.test.tsx` asserts there is exactly one.
  - **Every ancestor between the frame and the scroller needs `min-h-0`.** A flex child defaults to `min-height: auto` and refuses to shrink below its content, so one missing `min-h-0` silently hands the scroll back to the page and the header leaves with it.
  - **A page with no frame at all is the deviation.** The only screens that skip one are those whose whole body is the header (`dashboard`). `TableFrame` keeps a `framed={false}` escape for a body not worth pinning; nothing passes it today, so reaching for it needs a reason you can state.

- **A card marks a boundary. No boundary, no card.** It earns its border in exactly two places: between SIBLING RECORDS, where each card is one of many of the same thing (`permissions.tsx` — one card per admin), and between a SURFACE and the page, which is why `TableFrame` wraps a table in one. Everywhere else the border is decoration that costs a rule and `p-4` of padding.
  - **A page that is one continuous form is ONE section, not a stack of cards.** Headings and spacing group it; you only need a line where the eye would otherwise merge two unrelated blocks. `base-config-form.tsx` (10 cards), `student-detail.tsx` (7) and `test-series-form.tsx` (5) are the shape to stop copying — a card inside a card, as in the first, communicates nothing at all.
  - **The section scrolls, and the actions stay inside it.** Save and Cancel belong to the form, so they sit in the section that scrolls with it — never floated into the page header, and never left below a scrollport where they cannot be reached. `FormDialog` is the worked example: no cards, fields in a column, buttons pinned in the footer of the same box.
  - **Reach for a card only after you can name the boundary in a sentence.** If the sentence is "it groups the fields", spacing already did that.

- **Confirm before anything that destroys, revokes, grants, or changes what somebody can do** — `ConfirmDialog`, never a chip in a row. Name the consequence, include the count (`studentCount`, `groupCount`). **A toggle confirms in both directions.** Confirm even when reversible if the effect is invisible from where it happens (retiring a branch).
  - Skip the dialog only when the screen already previews exactly what it would do (import commit).
  - Where per-click confirmation would be absurd, **batch the clicks**: hold the draft as a **diff against the server**, show the pending count where a collapsed section still shows it, confirm once listing every change, and drop the draft after a save whether it succeeded or failed.
- **An icon-only control is round.** `Button size="icon"` / `size="iconSm"`, and a collapsed rail row — the target IS the glyph, so its hover is a disc around it. A rounded rectangle around a 16px icon reads as a box that happens to contain one, and its corners belong to nothing. A control carrying a label stays `rounded-md`, however small.
- **Anything that animates in animates out.** Radix keeps a closing overlay mounted only while an animation is running on it, so an entry animation with no exit does not read as "fast" — it reads as a bug, because the panel disappears on the frame the state flips. Pair every `data-[state=open]:animate-*-in` with a `data-[state=closed]:animate-*-out`. Leaving is quicker than arriving and eases in rather than out.
- **Content waits use `Skeleton`; actions use `Spinner`/`LoadingState`.** Tables, lists, cards and forms have a known shape — draw and hold it. Spinners are for a button mid-request (`Button loading`), a save, a file being read. Never hand-roll `<Loader2 className="animate-spin" />`.
- **Every dropdown is `Combobox`. The native `<select>` is not a design-system control.** Its closed state matches, but the list it opens is drawn by the OS — a different typeface, spacing and highlight on every machine, sitting beside a `Combobox` on the same screen. Pass no `search`/`onSearchChange` for a short fixed list and it renders a plain unsearchable list; pass them for anything that can outgrow a page. One component, one look, whether the options are three or three thousand.
  - **`clearable` is a decision, not a default.** It prepends the placeholder as a real "no choice" row. A filter that already offers `<option value="">Any branch</option>` must not also be clearable, or the same answer appears twice.
  - **`Select` remains only for what is genuinely a native control** — nothing today. Reaching for it needs a reason you can state, and "it is fewer lines" is not one.
- **A date is picked with `DatePicker`, never `<input type="date">`.** The browser's picker is drawn by the browser: Chrome, Safari and Firefox each render a different calendar, and a phone renders a fourth. `DatePicker` speaks `YYYY-MM-DD` — the shape `dateOnlySchema` takes — and computes in UTC, because a day built from a local `Date` serialises as the day before in any zone behind Greenwich. Pass `max={todayISO()}` for anything the server caps at today, so the rule is visible before it is enforced.
- **A list control never ends silently at its first page.** `PAGE_SIZE_MAX` stays 100; anything that can outgrow it uses `Combobox` + `useInfinitePages` with server-side search. Never a plain `<select>` over one capped request.
- **A row's actions live behind ONE menu, never spread across the row.** `DropdownMenu` with a single icon trigger in the last column; Edit, Retire, Delete and "open the children" are all items inside it. Every extra button is a fixed strip of width taken from every row forever, and it is the content that pays — the wider the table, the more of it goes. A `ConfirmDialog` still guards what needs guarding; the menu item opens it.
  - **A count is a link, not a button.** Reaching a row's children costs nothing extra when the number already on screen is the affordance (`branch.studentCount` → the students screen). Prefer that to a labelled button, and never ship both.
  - The shape to stop copying: `branches.tsx`, `exams.tsx`, `programs.tsx`, `base-configs.tsx`, `test-series.tsx` and `taxonomy.tsx` each spread two to four buttons across a row today.
- **Text in a table cell is `TruncatedText`. Always — this is not a per-column decision.** One line, cut to the column, a tooltip only when something is genuinely hidden, and a muted dash when the value is null. A bare `{row.name}` lets one long value widen its column and push the rest off the screen, and the row that did it is never the row you were looking at.
- **Variable chips in a table cell use `BadgeList`** — first one (or `max`), then a focusable `+N` whose tooltip lists the rest. Never put a value only in a tooltip; anything a decision depends on belongs on a detail screen or behind a filter.

## Design system

Tailwind + shadcn/ui, tokens in `packages/ui`. Brand primary `#B83939`; Cancel = neutral grey;
destructive = crimson `#BE123C`; charts use the colorblind-safe set, never brand red. Light + dark
via CSS variables. `docs/design/design-system.html` is the living style guide.
