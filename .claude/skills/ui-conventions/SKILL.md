---
name: ui-conventions
description: The binding shared-code and UI-behaviour rules for this repo - where a component lives (packages/ui vs app-kit vs apps), the shape of a list screen, navigation, confirm dialogs, loading states, pagination and chips. Use before writing or changing ANY screen, component, form, table, dialog, filter or nav entry in apps/admin or apps/test, and before adding anything to packages/ui or packages/app-kit.
---

# UI conventions

<binding>

Every bullet is a rule, not background. **Binding: no deviations.** Where a bullet allows a
judgement it says so, and the judgement is one sentence you write down. A rule you cannot follow is
a conversation, not a judgement call.

Read `packages/ui/src/index.ts` — the component inventory — before building any UI.

Files named in a bullet are the shape to STOP copying, not licence to add another.

</binding>

## Shared code

- **Check `packages/ui` and `packages/app-kit` first.** Extend the shared component; never write a local variant.
- **A component belongs in `apps/` only if it names a domain concept** (`SubjectPicker`, `SuperAdminOnly`). Describable without a domain noun → `packages/ui`, the first time.
- **`packages/ui` is design and carries no domain knowledge** — `Pagination` takes page sizes as a prop, and a wire format like the filter CSV never reaches it. **`packages/app-kit/src` is DOM-free**; browser-only adapters go in `@iace/app-kit/browser`. **`packages/contracts`** holds types, schemas and the typed client.
- Apps own only their wiring: routes, nav, `STORAGE_KEYS`, `ROUTES`, login, dashboard.
- **Design values come from `packages/ui` tokens.** Never a raw hex or one-off spacing in a feature component.

## Screens

**Build the screen the way the app already builds that kind of screen.** Open two that do this job before writing a third; deviate only for a reason you can state in one sentence.

- **List screen:** `TableFrame` with `PageHeader` in `header` and ONE `ListView` inside. Not a bare fragment, not a hand-rolled header above a card, and never `FilterBar` + `DataTable` + `Pagination` wired by hand again. `TableFrame.toolbar` survives for something a list does not own; nothing passes it today, so reaching for it needs a stated reason — a banner belonging to the list is `ListView`'s `banner`.
- **The unit that repeats is the LIST, not the screen.** Two lists on a page = two `ListView`s; a list in an expand panel = a `ListView` with no frame. `useListScreen` is a HOOK, not a component, so it composes with whatever wraps a list — tabs, panels, `SuperAdminOnly`.
- **A list with neither filters nor server pagination stays a bare `DataTable`** (`branches.tsx` loads every branch at once). That is the whole exception.
- **Filters are a SPEC, not hand-built controls.** One array of `{ key, kind, label }` declares the URL keys, and from it come the controls, the active count, what Clear drops and the query — so those four cannot disagree. Kinds: `search`, `choice` (its `items` carry their own "Any …" row), `multi`, `date`, `custom` and `customMulti` for a server-searched paged picker. A sixth kind is a change to `ListFilter`, never a slot at a call site. `primary` sits beside the search box; the rest fold behind "Filters", and a set folded filter opens the fold.
- **`toQuery` is where a filter stops being a string** — one control may set several params, and casts belong there, not in the spec. A CASCADE (a subject that must drop its topic) is a relationship the spec does not model, so those screens keep `useFilters` beside it and say so in one line. `useFilters` is also how you reach a URL key that is not a filter: the open tab, or a param that highlights a row.
- **A set-valued filter choosing nothing means ALL of them, never none.** Three layers refuse to build an empty set — `csvQuery` returns undefined rather than `[]`, `queryString` drops an empty array, `ListView` counts it as no filter — because Prisma reads `in: []` as "match nothing" and would blank the table while looking like real data.
- **A filter bar never grows a strip of chips.** The chosen values are NAMED on the control, cut to its width with a tooltip carrying the rest (`chips={false}`). The rows are what the reader came for, and a strip that appears on the first pick and grows on every one after pushes them down the page while they are still choosing. A FORM keeps its chips: nothing moves under them.
- **Several filters combine as the reader chooses — `Match filters: All / Any`,** in the bar beside Clear, in plain words rather than AND and OR. It rides the URL as `?match=any`, absent when it is the default, so a list narrows exactly as it always did until somebody asks otherwise. A search and a date range stay outside it — they say what you are looking at, not which of it — and a sort is not a filter at all (`alwaysApplies`). `matchFilters` on the server is the one place that decides, and it refuses an OR it cannot mean: below two chosen filters it returns what ALL would. The control appears only where two or more filters can combine.
- **"None match" and "there are none yet" are different facts.** `ListView` takes `empty` and `emptyFiltered`; the wrong one sends an admin looking in the wrong place. Never rebuild that ternary at a call site.
- **A read-only form must not freeze the controls for READING it.** `FormPanel` disables with `fieldset[disabled]`, which the HTML spec applies to every form control beneath it — which is why a tab trigger is a `span` and not a button. Choosing which language or view you are reading is navigation, not editing.
- **Creating or editing ONE entity is a `FormDialog`,** never a card above the table. Pass the whole `form` — it resets on close, which a mounted dialog will not. An edit dialog is mounted only while a row is being edited and keyed by that row's id, or it opens showing the previous row's values.

## Navigation, tabs and panels

- **Every destination sits under a section in `NAV_ITEMS`.** A lone top-level row is the deviation.
- **Sub-features close enough to be one idea share ONE nav row and split INSIDE the page with `Tabs`** (subjects and topics are two levels of one taxonomy, read in the same sitting). Pass `TableFrame` its `tabs={{ value, onValueChange, items }}`, each item carrying its own `ListView`. **Never hand-build `Tabs`/`TabsList`/`TabsContent` around a `TableFrame`** — that needed `min-h-0` on the root and every `TabsContent` plus a `-mx-4 px-4` bleed, and one wrong class hands the scroll to the page. `TableFrame` owns all four. Inside a form they are still yours to place (`question-form.tsx`, a question's languages). One primary action in the header, naming the open tab.
- **Tabs are for that and for views of ONE record.** Not for a parent's CHILDREN — those open in a panel under the row — and not for unrelated screens, which are nav rows. The test: would a reader think of the two as one job?
- **A child list whose columns would repeat its parent belongs in a panel under that parent.** `DataTable`'s `expand` gives the row a chevron and a panel capped and scrolling inside itself, so a long child list cannot push the rows above it off screen. The reader can hold two open to compare.
- **A child someone would search for WITHOUT knowing its parent also earns its own route** — and may have both. Nobody wants every Tier 2 across every exam, so stages are a panel only; "find the topic called Percentages" is real, so topics keep a list.
- **Detail that is only ever a row's own is a panel** — extra fields, a summary, an audit trail. Never addressable alone, never searched across, so a second screen buys nothing.
- **Editing inside a panel is the same editing as anywhere: a `FormDialog`,** behind one `RowActions` menu. Expanding replaces the second SCREEN, not the conventions.
- **Every page carries its trail: `PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}`.** Derived from the nav and the route, so it cannot go stale. A detail screen passes `tail` for the record it shows; a top-level screen renders nothing. **Never a hand-rolled back button** — the trail holds the parent and collapses to exactly that below `sm`.
- **The nav never takes space from the page.** The icon rail is the resting state and the only nav in the layout flow, so the content region is a constant. Opening it opens a portalled `Sheet` OVER the page, closing on navigate, Escape and click-outside. Never widen a flex sibling of `<main>`. In the panel one section opens at a time; the rail, and a section past `NAV_INLINE_MAX_ITEMS`, open a popover beside the row. **On touch the panel drills down** — a popover over a sheet is a modal over a modal.

<scrolling>

Every failure here is silent: the page looks built, and the header or the pager has quietly left.

- **A header that carries actions never scrolls away — pin the header, scroll only the body.** Any page whose `PageHeader` holds an action (New, Save, Import), not just lists. A Save button that scrolls off the top is one the user has to hunt for.
- **Reach for the frame, don't rebuild it.** `TableFrame` for a list, `PageFrame` for everything else. Both mark `data-page-frame`, which flips the shell's `PAGE_CONTENT_CLASS` to `overflow-hidden` via `:has()`, and both hold the header at `shrink-0`. `TableFrame` makes the table the scroller so filters and pager stay put; `PageFrame` makes its body the scroller. A hand-rolled sticky header is the deviation.
- **One scrollport per page, one per section, never two nested.** A scrollbar inside a scrollbar strands content: the outer looks finished while the inner still has rows. Inside a frame nothing takes its own `overflow-y-auto`; a tall child gets `min-h-0` instead. Portalled popovers do not count. A dialog is its own page — `DialogBody` scrolls, the wrapper does not (`dialog.dom.test.tsx` asserts exactly one).
- **Scrollbars are styled once, globally** (`components.css`), never per component. Every scroller sits inside a border and a radius, so a platform-width bar lands on the rounded edge and reads as a seam. Thin, muted, inset, and 0px of layout width so a body that starts scrolling does not shift.
- **A scrollport must also be a containing block — give it `relative`.** An absolutely positioned descendant of a `static` scroller resolves against the nearest positioned ancestor, escapes the scroll and grows the DOCUMENT. `sr-only` is `position: absolute`, which is how a hidden `<legend>` once put a scrollbar across the whole app.
- **Every ancestor between the frame and the scroller needs `min-h-0`.** A flex child defaults to `min-height: auto` and will not shrink below its content, so one missing `min-h-0` hands the scroll back to the page and the header leaves with it.
- **A page with no frame is the deviation.** Only a page whose whole body is the header skips one (`dashboard`). `TableFrame`'s `framed={false}` escape has no callers, so using it needs a stated reason.

</scrolling>

<copy>

The people reading these screens ran exam centres before they saw them. Write for that reader.

- **Call a thing what the exam world calls it.** A label is the standard term, never a description of it. They know _sectional timing_, _composite_, _merit_, _qualifying_, _negative marking_. "A clock per section" instead of "Sectional" makes a reader who knows the word translate back into it, and makes the screen disagree with the coaching material and the enum underneath.
  - **The enum name is usually the answer.** `SECTIONAL_LOCKED` is Sectional; `MERIT`/`QUALIFYING` are Merit and Qualifying. A label drifted from the constant it renders is the label that is wrong.
  - **A gloss goes in the hint, never instead of the term** — `label: 'Sectional'`, `hint: 'A clock per section; it locks when its time ends'`. Serves both readers; choosing one is the mistake.
  - **A unit belongs in the label**: "Duration (minutes)", not "Duration" with "In minutes" beneath.
  - **Write the word out.** "Base configuration", never "Base config". A shortened word is not a shorter label — it is a word the reader has to expand, and this reader came from running exam centres, not a codebase where `config` is ambient. Holds in nav rows, titles, columns, buttons, empty states, toasts and confirm text. **An acronym the exam world already says stays**: SSC, RRB, MCQ, OTP, PIN, DOB. The test is whether the reader has to expand it.
  - **Same word, same meaning, everywhere** — a column, a `StatRow` and a form field showing one value use one term. The code keeps its own names: `baseConfigs` and `/tests/configs` are identifiers, not labels.

- **A screen does not explain itself. Write no description that says what a section IS.** The reader opened Students because they wanted students. `PageHeader` and `FormSection` have no `description` prop — they take `meta`, for a value the record carries. Reaching for it to write a sentence means the sentence is what is wrong.
  - **The test: could the reader work it out from the heading, the columns and the buttons already on screen?** If yes, delete it.
  - **What earns its place** is what they CANNOT infer: a value (`12 sections, 240 questions`), or a consequence invisible until too late (this code can never change once a student carries it). ONE line, next to the control it constrains.
  - **A `ConfirmDialog` keeps its description** — there the description IS the information: the consequence and the count.
  - **Whatever survives is said in an `Alert`, never in prose on the page.** The variant carries half the meaning before a word is read: `info` for a fact they could not infer, `warning` for something that will cost them, `danger` for something already wrong, `success` only where the outcome is invisible from the screen. A muted `<p>` reads as CONTENT — the eye files it with the data and skips it — so the sentence is on screen and the meaning never lands. **The action that resolves it goes INSIDE the alert** (`PreTestPrompt`). **Never build a table or a row of chips out of something an Alert should say**: a sentence is taken in, a table has to be assembled.
  - **A `hint` is the same rule one level down: the label already said what the field is.** "The number you signed up with" under _Mobile number_ tells the reader nothing. If deleting the hint loses nothing, it was never a hint. A hint earns its line by carrying a UNIT, FORMAT, LIMIT or RULE the field cannot show — "Per wrong answer", "Blank means none", "Optional", "Locked once a student is enrolled" — each something they would otherwise learn from an error after typing. **Say the rule, not the advice**: "Avoid 1234" reads as a suggestion for something the server refuses outright.
  - Teaching the domain is documentation's job. A genuinely hard rule belongs in `docs/`, in the hint, or in the server's error — not in prose above a table.

</copy>

## Cards, confirms and controls

- **A card marks a boundary. No boundary, no card.** It earns its border in two places: between SIBLING RECORDS, each card one of many of the same thing (`permissions.tsx`, one per admin), and between a SURFACE and the page (`TableFrame`). Elsewhere it is decoration costing a rule and `p-4`.
  - **A page that is one continuous form is ONE section, not a stack of cards.** Headings and spacing group it. `base-config-form.tsx` (10 cards), `student-detail.tsx` (7) and `test-series-form.tsx` (5) are the shape to stop copying — a card inside a card communicates nothing.
  - **The section scrolls and its actions stay inside it.** Save and Cancel belong to the form, never floated into the page header or left below a scrollport. `FormDialog` is the worked example.
  - **Name the boundary in a sentence before reaching for a card.** If the sentence is "it groups the fields", spacing already did that.
- **Confirm anything that destroys, revokes, grants, or changes what somebody can do** — `ConfirmDialog`, never a chip in a row. Name the consequence and the count. **A toggle confirms both ways.** Confirm even when reversible if the effect is invisible from where it happens (retiring a branch).
  - Skip it only when the screen already previews exactly what it would do (import commit).
  - Where per-click confirmation would be absurd, **batch the clicks**: hold the draft as a diff against the server, show the pending count where a collapsed section still shows it, confirm once listing every change, and drop the draft after a save either way.
- **An icon is sized by the component that holds it, never the call site.** `Button` and `DropdownMenuItem` carry `[&_svg]:size-4`; lucide defaults to 24px. A per-icon `className="size-4"` is the symptom, not the fix.
- **Never call `.focus()` to put focus back.** It sets the browser's focus-visible flag, so a control dismissed with the MOUSE lights up with a keyboard ring. Radix already restores focus against the pointer/keyboard heuristic.
- **One focus treatment: `focus-visible:shadow-focus`**, which reads the `--focus-ring` token. Never hand-roll `ring-2 ring-offset-2`. **The one exception** is a control repeating once per row: `RowActions` fills instead (`focus-visible:bg-muted focus-visible:shadow-none`), because a ring down the last column reads as an alert rather than a position.
- **A glyph-only control names itself on hover AND focus** — `Tooltip`, not native `title`, which keyboard focus never fires. Keep the `sr-only` label; a tooltip is not an accessible name. **And it is round** (`Button size="icon"`): the target IS the glyph, so its hover is a disc. A control carrying a label stays `rounded-md`.
- **Anything that animates in animates out.** Radix keeps a closing overlay mounted only while an animation runs, so an entry animation with no exit reads as a bug — the panel vanishes on the frame the state flips. Pair every `data-[state=open]:animate-*-in` with its `-out`. Leaving is quicker than arriving.
- **Content waits use `Skeleton`; actions use `Spinner`/`LoadingState`.** Tables, lists and forms have a known shape — draw and hold it. Never hand-roll `<Loader2 className="animate-spin" />`.
- **Every dropdown is `Combobox`; the native `<select>` is not a design-system control** — the OS draws its list, so it differs on every machine. Omit `search`/`onSearchChange` for a short fixed list; pass them for anything that can outgrow a page. There is no `Select` to reach for: it was deleted, and `no-restricted-syntax` catches a raw `<select>`.
  - **`clearable` is a decision, not a default.** It prepends the placeholder as a real "no choice" row, so a control already offering "Any branch" must not also be clearable. A `choice` filter cannot get this wrong — `ListView` passes `clearable={false}`. A paged `custom` picker usually wants it, having no "Any" row to spare.
- **A date is picked with `DatePicker`, never `<input type="date">`** — every browser draws its own calendar. It speaks `YYYY-MM-DD` (what `dateOnlySchema` takes) and computes in UTC, because a day built from a local `Date` serialises as the day before west of Greenwich. Pass `max={todayISO()}` where the server caps at today.
- **A list control never ends silently at its first page.** `PAGE_SIZE_MAX` stays 100; anything that can outgrow it uses `Combobox` + `useInfinitePages` with server-side search. In a filter bar that is a `custom`/`customMulti` filter — a `choice` hands its whole list over as `items`, which is what a paged picker cannot do.
- **A row's actions live behind ONE menu.** `RowActions` in the last column; Edit, Retire, Delete and "open the children" are all `DropdownMenuItem`s, the destructive one taking `destructive`. Every extra button is a fixed strip of width taken from every row forever, and the content pays.
  - **A count is a link, not a button** (`branch.studentCount` → the students screen). Never ship both.
  - An action the row cannot take is **left out**, not disabled — a permission the reader does not hold is not a row of greyed text (`branches.tsx`).
- **Text in a table cell is `TruncatedText`. Always, not a per-column decision.** One line, a tooltip only when something is genuinely hidden, a muted dash when null. **It needs a bound to cut against** — give the column a `max-w-*`, or `truncate` does nothing at all, because the table sizes the column to its content.
- **Variable chips in a cell use `BadgeList`** — first one (or `max`), then a focusable `+N` whose tooltip lists the rest. Never put a value only in a tooltip; anything a decision depends on belongs on a detail screen or behind a filter.

## Design system

Tailwind + shadcn/ui, tokens in `packages/ui`. Brand primary `#A8221B`; Cancel neutral grey;
destructive crimson `#BE123C`; charts use the colorblind-safe set, never brand red. Light + dark via
CSS variables. `docs/design/design-system.html` is the living style guide.
