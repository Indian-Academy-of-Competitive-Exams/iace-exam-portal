# Test creation, made friendly — implementation plan

> **For agentic workers:** T1 and T2 are high-stakes (a counter every future draw reads, and the
> paper's own rows). T3 touches a shared hook. T4–T6 are UI. Lean loop per
> `docs/superpowers/WORKFLOW.md`; invoke the `ui-conventions` skill before any screen work.

**Goal:** Building a test stops being a form you fill in blind. You can see the questions you are
choosing and the ones you drew, swap one without redrawing the lot, and read the blueprint without
it sitting in the middle of the page. The screen stops explaining itself in alerts.

## What is wrong today

- **Picking questions is a one-line dropdown.** `QuestionMultiPicker` renders
  `questionCode ?? stemPreview` and nothing else, while `questionSummarySchema` carries difficulty,
  topic, tags, languages and a stem preview, and `questionListQuerySchema` already takes
  `topicId`, `difficulty`, `type`, `tag`, `language` and `sort`. The data is there and the screen
  shows none of it.
- **The drawn paper is invisible.** A section says "25 of 25" and an admin finalizes a paper they
  have never seen. Changing one question means redrawing all of them.
- **The blueprint sits in the page.** `ConfigSummary` is an accordion between the header and the
  fields, in `text-xs` so it reads as a footnote of a screen it is not part of.
- **Twelve alerts.** Several teach the domain or repeat what a button already says.
- **Two strings are now false.** `test-builder-offering.tsx:129` and `:163` still say finalizing
  locks the base configuration. It stopped doing that when the lock moved to the first attempt.

## Tasks

### Task 1: Thawing puts back what finalizing took

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** create `apps/api/src/tests/thaw.ts`; modify `apps/api/src/tests/tests.service.ts`,
`apps/api/src/tests/paper.service.ts`, `apps/api/src/tests/test-rules.ts`; extend
`apps/api/test/tests-service.unit.test.ts` and `apps/api/test/paper-service.unit.test.ts`.

- [x] `finalize` increments `Question.fixedUseCount` once per question on the paper. Nothing
      decrements it, so a test that is thawed, edited and finalized again counts every surviving
      question twice — and `fixedUseCount` is exactly what `LEAST_SERVED` ranks on, so the bias is
      permanent and invisible.
- [x] One `thaw(tx, test)` that applies `unfreezing()` AND decrements the counts for the paper the
      test currently holds. Both callers use it; neither writes the patch by hand.
- [x] Never below zero: a draft that was never finalized has nothing to give back.
      **Acceptance:** finalize, thaw, finalize again leaves every question counted once; a test
      thawed without ever having been finalized changes no count; a rename still counts nothing.

### Task 2: One row of the paper can be replaced or removed

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `packages/contracts/src/tests.ts`, `packages/contracts/src/client.ts`,
`apps/api/src/tests/paper.service.ts`, `apps/api/src/tests/tests.controller.ts`; extend
`apps/api/test/paper-service.unit.test.ts`.

- [x] `PATCH /admin/tests/:id/paper/:rowId` takes `{ questionId }` and swaps the question on one
      row, keeping its `order` and pinning the new question's `currentVersionId`.
- [x] `DELETE /admin/tests/:id/paper/:rowId` drops one row. Its `order` leaves a gap, which is
      what `@@unique([testId, order])` allows and what leaves the section reading Short.
- [x] Both refuse once the test has been sat, and both thaw a frozen one through Task 1's `thaw`.
- [x] The replacement must belong to the section's subject and must not already be on the paper —
      `@@unique([testId, questionId])` would refuse it, and a caught constraint error is not an
      error message.
      **Acceptance:** replacing keeps the paper's length and order; removing leaves the section
      short of its count; a question already on the paper is refused by name; a sat test refuses
      both.

### Task 3: The list shape works off local state, not only the URL

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `packages/app-kit/browser/use-list-screen.ts`, `packages/app-kit/browser/index.ts`;
create `packages/app-kit/browser/use-local-filters.ts`; extend
`packages/app-kit/test/use-list-screen.dom.test.tsx`.

- [x] `useListScreen` takes an optional filter store, defaulting to `useFilters()`. A dialog's
      filters are not a link anyone shares, and one section's topic filter must not survive into
      the next section's dialog.
- [x] `useLocalFilters` implements the same four methods in component state.
      **Acceptance:** a list backed by local filters narrows, clears and counts exactly as the URL
      one does, and writes nothing to the address bar.

### Task 4: Choosing questions is a real list

**Risk:** normal · **Reviews:** 0 (caveman) · **Model:** opus
**Files:** rewrite `apps/admin/src/components/question-picker.tsx`; modify
`apps/admin/src/routes/test-builder-paper.tsx`.

- [x] A dialog per section: search, topic, difficulty and tag filters, a checkbox per row, and the
      code, stem, topic and difficulty on every row. `ListView` with a `selection` and a local
      filter store — the same list shape as every other screen, not a hand-built table.
- [x] The topic filter is narrowed to the section's subject, since that is what the draw will use.
- [x] The footer says how many are chosen against how many the section needs.
      **Acceptance:** an admin can find a question by topic and difficulty without knowing its
      code, sees what they have chosen, and the chosen set survives closing and reopening.

### Task 5: The paper step shows what it drew

**Risk:** normal · **Reviews:** 0 (caveman) · **Model:** opus
**Files:** modify `apps/admin/src/routes/test-builder-paper.tsx`.

- [x] Each section expands to the questions actually on the paper, in order, with code, stem,
      topic and difficulty. `DataTable`'s `expand` gives the panel its own cap and scroll.
- [x] One `RowActions` menu per question: Replace (opens the picker for one) and Remove
      (destructive, confirmed).
- [x] Draw again moves into a `ConfirmDialog` naming what it replaces and, on a frozen test, that
      it unfreezes and stops the test being offered. Both alerts that said so are then redundant.
      **Acceptance:** an admin reads the paper before finalizing it and swaps one question without
      redrawing the rest.

### Task 6: The blueprint moves to the header, and the screen stops explaining itself

**Risk:** normal · **Reviews:** 0 (caveman) · **Model:** opus
**Files:** rewrite `apps/admin/src/components/config-summary.tsx`; modify
`apps/admin/src/routes/test-builder.tsx`, `apps/admin/src/routes/test-builder-offering.tsx`.

- [x] The accordion strip goes. The configuration's name becomes a button in the header opening a
      `Dialog` holding the configuration AND a per-section table: questions, marks each, negative,
      duration, merit or qualifying.
- [x] `text-sm` throughout, as everywhere else. The `text-xs` was a strip's compromise and a
      dialog has room.
- [x] Twelve alerts become six. Going: "Drawing again replaces every question below", "drawing
      again unfreezes it", the series teaching alert, the finalize info alert, and the config
      summary's own. Staying: the load failure, the server banner, the sat warning, draw
      shortfalls, "this test draws per student", and the publish gaps.
- [x] Correct the two strings that say finalizing locks the base configuration. It does not, and
      has not since the lock moved to the first attempt.
      **Acceptance:** the blueprint is one click from the header and never in the way; nothing on
      the screen tells the reader something the headings and buttons already do.

## Verify on screen

- The picker dialog scrolls its own body and does not put a second scrollbar inside the step.
- Reopening a section's picker still shows what was chosen.
- The config dialog's section table is readable at the same size as the form behind it.
