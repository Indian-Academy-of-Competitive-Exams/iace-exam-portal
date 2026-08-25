# Test builder — phased stepper — implementation plan

> **For agentic workers:** run caveman per `docs/superpowers/WORKFLOW.md` (UI screens take gates
> only; the human reviews the diff). Steps use checkbox (`- [ ]`) tracking.

**Goal:** Creating a test stops being one long scroll with three different save models hidden in
it. Five explicit steps, a stepper pinned above the body that opens on whichever step the test's
own state says it has reached, Next as the only save, a mandatory name, and the inherited
configuration compressed into one dense strip instead of a block wedged between the fields.

## The problem being fixed

`apps/admin/src/routes/test-form.tsx` renders five `FormSection`s in one scroll that do not
behave alike:

| Section                                | How it saves                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| Which paper this is / How it is judged | form fields → footer **Save test**                                   |
| The paper                              | **Draw** button, mutates immediately                                 |
| Where it is offered                    | series picker + **Finalize** + **Retire**, each mutating immediately |

So the footer Save covers only the top half and Cancel abandons nothing done in the bottom half,
with nothing on screen saying so. Alongside that: `PaperStep`/`OfferingStep` render only when
`detail` exists, so create and edit are two different screens on one route; nothing shows where a
test is in its life; `InheritedShape` splits the two field sections it sits between; and `title`
is optional, so `'Untitled test'` and `'this test'` fallbacks run through the header and both
confirm dialogs.

## The design

`FormPanel`'s `header` slot is `shrink-0` and sits outside the `<fieldset>`, so the stepper lives
there — pinned above the scrolling body, and never disabled by a frozen test.

```
+---------------------------------------------------------+
| Tests / SSC CGL Tier 1 - Mock 1             <- PageCrumbs|
| SSC CGL Tier 1 - Mock 1                     <- PageHeader|
| SSC CGL / Tier 1                               meta      |
|                                                          |
|  (1)-----(2)-----(3)-----(4)-----(5)        <- Stepper    |
|  Blueprint Rules Paper Series Publish                    |
|                                                          |
|  Standard . 12 sections . 240 questions . 200 marks      |
|  2h . Sectional . English, Hindi                      v  |  <- strip
+---------------------------------------------------------+
|                                                          |
|  (only the open step's body - this is the scroller)      |
|                                                          |
+---------------------------------------------------------+
|                             [ <- Back ]   [ Next -> ]    |
+---------------------------------------------------------+
```

**The five steps**

| #   | Step      | Owns                                                                  |
| --- | --------- | --------------------------------------------------------------------- |
| 1   | Blueprint | Exam → Stage → Base configuration (read-only once created) + **Name** |
| 2   | Rules     | Covers, scope reference, Evaluation, Paper, Retakes, Draw             |
| 3   | Paper     | Per-section counts, hand-picks, **Draw the paper**                    |
| 4   | Series    | Which series carry this test                                          |
| 5   | Publish   | Finalize → Offer to students / Retire                                 |

**Gating.** Before the draft exists only step 1 is live — there is no id for the others to write
against. Once it exists every step is clickable in any order; step 5 opened early says in an
`Alert` what is still missing rather than hiding its buttons.

**Resume point**, derived on mount, local state and not a URL param:

```
isLocked                -> (5) Publish
paperQuestionCount > 0  -> (5) Publish
FIXED, nothing drawn    -> (3) Paper
GENERATED               -> (4) Series
```

**Next is the save.** No Save button anywhere. Step 1 Next creates the draft (`POST`) or patches
the name; step 2 Next patches the rules; steps 3 and 4 have nothing pending, so Next only moves.
One `useForm` in the shell spans steps 1 and 2 because they are one record, and jumping via the
stepper away from a dirty step 1 or 2 runs the same save Next would. Validation stays the
server's, as it is everywhere else in this app: a 422 lands on the field through
`applyFieldErrors` and the step does not advance. No `rules` prop, no second copy of the message.

**A frozen test** keeps all five steps browsable and opens on Publish. Its per-control
`disabled={frozen}` flags stay — `FormPanel`'s `disabled` prop cannot be used, because
`fieldset[disabled]` is all-or-nothing and the Name field has to stay live.

**Deliberate judgement calls.** Draw stays a body button on step 3 rather than moving to the
footer: it is repeatable and acts on what is on screen, unlike Next. Step 5 reached early is
reachable-but-explained rather than blocked.

## Binding / workflow

Read `docs/superpowers/task-constraints.md` and the `ui-conventions` skill (binding for every
task here). `prisma/schema.prisma` is the source of truth; it does not change — `Test.title`
stays `String?`, and the fallbacks survive for rows that predate the rule. Model: opus
throughout.

---

## Tasks

### Task 1: Contracts + API — mandatory name, drawn count, the step rule

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Exemplar:** `packages/contracts/src/tests.ts` (`allowedPaperBindings` for a domain rule that
ships to both SPAs); `apps/api/src/tests/tests.service.ts:41` for the `_count` select.
**Files:** modify `packages/contracts/src/tests.ts`, `apps/api/src/tests/tests.service.ts`;
extend `packages/contracts/test/tests.test.ts`.

- [ ] Lift `title` out of `testOwnFieldsSchema`: `createTestSchema` takes `testTitleSchema`
      (required), `updateTestSchema` takes `testTitleSchema.optional()` — omitting a name on an
      edit is fine, clearing one is not.
- [ ] Add `paperQuestionCount` to `testSchema`, fed by adding `paperQuestions: true` to the
      existing `_count` select. No extra query; it serves both the resume point and step 3's
      "N of M drawn".
- [ ] Add `TEST_BUILDER_STEPS` (`BLUEPRINT`, `RULES`, `PAPER`, `SERIES`, `PUBLISH`) and
      `testBuilderStepOf(test)` beside `allowedPaperBindings`. The rule is domain and belongs in
      contracts; the labels are UI and stay in `apps/admin/src/lib/constants.ts`. It lives here
      rather than in the route because `apps/admin` has no test runner.
- [ ] Check every caller of `api.admin.tests.create` still compiles with a required title.
      **Acceptance:** the API refuses a create with a missing or blank name and accepts one with
      a name; an update that omits the name succeeds; a test detail carries how many paper
      questions are drawn; the step rule returns Publish for a locked test and for a drawn draft,
      Paper for an undrawn FIXED draft, and Series for a GENERATED one.

### Task 2: `Stepper` in `packages/ui`

**Risk:** mechanical · **Reviews:** 0 · **Model:** opus
**Exemplar:** `packages/ui/src/components/ui/tabs.tsx` for the reachable/unreachable trigger
question; `packages/ui/src/components/ui/pagination.tsx` for a numbered control.
**Files:** create `packages/ui/src/components/ui/stepper.tsx`,
`packages/ui/test/stepper.dom.test.tsx`; modify `packages/ui/src/index.ts`.

- [ ] `steps: { value, label, state: 'done' | 'current' | 'todo' }[]` plus `value` and
      `onValueChange`. Describable with no domain noun, so it belongs in `packages/ui`.
- [ ] A step the reader may open is a `<button>`; one they may not is a `<span>` — the same
      reasoning that made a tab trigger stop being a button, so a disabled fieldset can never
      swallow the navigation.
- [ ] Connectors drop and the steps wrap below `sm`. Tokens only, no raw hex, no
      `overflow-x-auto` (a second scrollport).
      **Acceptance:** the open step is visibly the current one and the ones behind it read as
      done; a `todo` step cannot be activated by click or keyboard; the strip stays usable at
      narrow widths.

### Task 3: Split the step components, no behaviour change

**Risk:** mechanical · **Reviews:** 0 · **Model:** opus
**Files:** create `apps/admin/src/routes/test-builder-paper.tsx`,
`apps/admin/src/routes/test-builder-offering.tsx`; delete
`apps/admin/src/routes/test-builder-steps.tsx`; modify
`apps/admin/src/routes/test-form.tsx` imports.

- [ ] Move `PaperStep` to `test-builder-paper.tsx` unchanged.
- [ ] Split `OfferingStep` into `SeriesStep` (the series picker) and `PublishStep` (finalize,
      offer, retire, both confirm dialogs) in `test-builder-offering.tsx`.
- [ ] `test-form.tsx` renders all three in sequence, so the screen looks and behaves exactly as
      it does today. This task is a pure move — it exists so Task 4's diff is the new shell
      rather than the shell plus a file split.
      **Acceptance:** the test screen is unchanged on screen; gates green.

### Task 4: The stepper shell, and retire `test-form.tsx`

**Risk:** normal · **Reviews:** 0 (caveman — the human reads the diff) · **Model:** opus
**Exemplar:** `apps/admin/src/routes/test-form.tsx` for the form wiring being carried over;
`packages/ui/src/components/ui/form-panel.tsx` for what the `header` and `footer` slots hold.
**Files:** create `apps/admin/src/routes/test-builder.tsx`,
`apps/admin/src/routes/test-builder-setup.tsx`,
`apps/admin/src/components/config-summary.tsx`; delete
`apps/admin/src/routes/test-form.tsx`; modify `apps/admin/src/lib/constants.ts`,
`apps/admin/src/App.tsx`, `apps/admin/src/routes/test-builder-paper.tsx`,
`apps/admin/src/routes/test-builder-offering.tsx`.

- [ ] `test-builder.tsx` is the shell: the detail query, the one `useForm` spanning steps 1 and
      2, the step state seeded from `testBuilderStepOf`, the `Stepper` and the configuration
      strip in `FormPanel`'s `header`, and the `Back`/`Next` footer. Step 5's footer carries
      Finalize, or Offer to students, or Retire — whichever applies.
- [ ] `test-builder-setup.tsx` holds the Blueprint and Rules bodies, carried over from
      `test-form.tsx` including `ScopeReference`, `pickExam`/`pickStage`,
      `pickEvaluationMode`, the `maxRetakes` numeric guard and `applyServerErrors`.
- [ ] `config-summary.tsx` replaces `InheritedShape`: one dense `text-xs` line of the values,
      expanding via `Accordion` to the per-section breakdown. Domain-named, so it stays in the
      app rather than `packages/ui`. The info Alert about the config owning marks and timing
      moves inside the expansion.
- [ ] Move Finalize/Offer/Retire out of `PublishStep`'s body and into the shell footer; the step
      body keeps the series-and-paper readiness Alert.
- [ ] Drop the `FormSection` title from each step body — the stepper already names the step, and a
      heading repeating it is the screen explaining itself. `meta` that carries a value
      (`"N of M drawn"`, the status) moves to the step body's Alert or the strip.
- [ ] `TEST_BUILDER_STEP_LABELS` in `apps/admin/src/lib/constants.ts`, mirroring how
      `TEST_SCOPE_LABELS` sits beside its constant. Write words out: "Base configuration".
      **Acceptance:** a new test opens on Blueprint with the other four steps inert, and Next
      creates the draft and moves to Rules; a nameless Next stays on Blueprint with the message
      on the Name field; reopening a draft with no paper lands on Paper, and one already drawn
      lands on Publish; every step is clickable once the draft exists; a finalized test opens on
      Publish with all five steps browsable, every control inert except Name; the header,
      stepper and strip stay put while the body scrolls.

---

## Verify on screen

Nothing below gets a test — they are layout and copy, and the reviewer checks them:

- The stepper and strip do not scroll away on a long step, and the strip's expansion does not
  create a second scrollbar.
- The strip reads smaller than the fields it sits above, and the per-section breakdown is
  hidden until asked for.
- Cancel on step 1 of a new test leaves no draft behind.
