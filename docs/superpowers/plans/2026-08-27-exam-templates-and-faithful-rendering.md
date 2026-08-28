# Phase 3 (continued) — Exam templates & faithful rendering — implementation plan

> **For agentic workers:** run the lean loop per `docs/superpowers/WORKFLOW.md`. Steps use
> checkbox (`- [ ]`) tracking. Acceptance criteria are BEHAVIOURS — the implementer writes the
> tests; no test code appears here.
>
> **Companion to** `docs/superpowers/plans/2026-08-24-phase3-test-engine.md`. That plan's engine is
> SHIPPED through T7; only its **T8 integration** is open. It built the exam screen as **one
> monolithic `ExamHall`** with a single `--exam-*` token set and an HTML-blob renderer that does
> **not** itself render math or tables. This slice does what that plan did not: re-architect the
> screen into an engine/template seam, ship two behaviourally-identical templates, make the content
> renderer faithful (images, tables, math, EN/HI/TE), seed a golden corpus to prove it, and close T8.

**Goal:** one exam engine, cheap skins. A test renders through a chosen template with **zero engine
change**; the content renderer shows every hard content type exactly as authored; and the milestone
end-to-end run is green. **Milestone:** the same sitting renders in both the Comfortable and the
Strict template, with a real question carrying an image, a table and an equation in all three
languages.

## What is already built that this leans on

- **The whole attempt back-end** — lifecycle, Redis live state + autosave batch, the ~60s flusher,
  safe submit + the sweeper, `GET /me/catalog` and the answer-key-free `ExamPaper`. Honours the
  scaling invariants. Nothing here is re-opened.
- **The engine's STATE already lives apart** in `apps/test/src/lib/use-attempt-state.ts` — answers,
  section state, autosave, flush. This is most of "the engine" already; the seam (RT3) extracts the
  PRESENTATION out from around it, it does not rebuild state.
- **A working monolithic screen** — `apps/test/src/routes/exam.tsx` (`ExamHall`) + `components/exam/*`
  (timer, section-timer, question-body, palette). Behaviour is proven, so RT3 is a refactor, not a
  rewrite.
- **Exam CBT tokens** exist — `tokens.css` §7 has the real 5-state palette (`--exam-answered`,
  `--exam-notanswered`, `--exam-notvisited`, `--exam-marked`, `--exam-answered-marked`,
  `--exam-current`, cell size/gap) in light + dark. It is **one** set, not per-template, and has no
  watermark / timer-position / selected-option tokens yet.
- **KaTeX + the authoring side** — `packages/ui/rich-text-toolbar.tsx` and
  `apps/api/src/questions/question-math.ts` render/validate `data-latex` spans. The exam renderer
  does NOT reuse this; RT1 makes it faithful to what authoring emits.

## Decisions (settled — do not re-open mid-slice)

- **Content stays HTML-per-language, not typed nodes.** The repo committed to storing rich content
  as an HTML string per language (`content[lang].stem` is `{text}[]` joined to HTML), and the
  authoring editor emits exactly that. This slice **hardens and renders** that HTML faithfully; it
  does NOT retype the model into TEXT/IMAGE/TABLE/MATH nodes. "Vocabulary" here means the allowed
  HTML tag/attribute whitelist, not a node union.
- **Two templates: Comfortable + Strict, behaviourally identical.** One engine; two registered skin
  instances. Comfortable is the polished default (design latitude); Strict is the austere real-CBT
  baseline the operator re-skins to an exact exam. The user takes one forward.
- **Per-template token namespace, scoped by data-attribute** (`[data-exam-template="…"]`), so one
  skin is re-themed to the exact exam appearance without touching the other. Still tokens-only — no
  raw hex in any component (CLAUDE.md rule). Exam tokens are a **separate namespace** from the brand
  palette, because the exam screen mimics the government CBT, not the IACE brand.
- **`Test.examTemplate` is config, defaulted from `BaseConfig`,** exactly like `languageMode` —
  chosen per test, carried in `ExamPaper`, never hardcoded in the screen.
- **Scoring, the score card, the solution report and the leaderboard stay Phase 4.** `ScoringProcessor`
  remains the no-op it is; this slice only renders and submits. Phase 3 still captures every data
  point Phase 4 needs.

## Invariants (the engine plan's four, plus this slice's three)

Carried unchanged from the engine plan: client-side clock, server owns `startedAt`/`endsAt`; autosave
to Redis, never Postgres per answer; submit enqueues a scoring job; **the answer key never leaves the
server during an attempt.** New for this slice:

- **The engine owns behaviour; a template owns only presentation.** A template imports no Redis, no
  mutation, no clock authority — it receives a view-model and renders. A new skin can never introduce
  a wrong palette state, a mis-anchored clock, or a lost answer.
- **No raw hex / one-off spacing in any exam component.** Every colour, font and dimension a skin
  varies is an `[data-exam-template]`-scoped token.
- **The renderer never executes author markup.** Bank HTML is sanitised to a whitelist before it is
  rendered; `dangerouslySetInnerHTML` over unsanitised content is a bug even though content is
  admin-authored today (the importer will ingest less-trusted ThinkExam HTML later).

---

## Sessions & estimates (lean loop, strong model)

| Session                              | Tasks                                                          | Risk          | Est.      |
| ------------------------------------ | -------------------------------------------------------------- | ------------- | --------- |
| **P3B-S1 — Render the hard content** | RT1 faithful+sanitised renderer, RT2 golden corpus             | high / normal | 1 – 1.5 d |
| **P3B-S2 — The seam**                | RT3 engine/template contract + registry                        | high          | 1 – 1.5 d |
| **P3B-S3 — The two skins**           | RT4 token namespace + `examTemplate`, RT5 Comfortable + Strict | normal        | 1.5 – 2 d |
| **P3B-S4 — Close out**               | RT6 = engine plan's T8 + template-switch milestone             | —             | 0.5 – 1 d |

**Total ≈ 4 – 6 focused days.** RT1 and RT2 are independent and may run concurrently; the spine is
RT1 → RT3 → RT4 → RT5 → RT6, with RT2 landing before the first visual QA.

---

## P3B-S1 — Render the hard content

### RT1 — A faithful, sanitised exam content renderer

**Risk:** HIGH · **Reviews:** 2
**Exemplar:** `packages/ui/src/components/ui/rich-text.tsx` (KaTeX render path, `katexOptions`);
`apps/api/src/questions/question-math.ts` (`data-latex` span shape); `packages/ui/src/katex.css`.
**Files:** create one shared exam content renderer (in `packages/ui` if it is design, else
`apps/test/src/components/exam/`); modify `apps/test/src/components/exam/question-body.tsx` to use it;
wire `katex.css`. A sanitiser util (whitelist) — reuse the authoring one if present, else add it.

- [ ] The renderer shows the bank's HTML faithfully in **both** themes and **each** language, DUAL
      rendering both stem and options with no toggle: **images** (sized, `max-w-full`, S3 src),
      **tables** (bordered; the table scrolls inside its own `overflow-x` box, the screen never does),
      ordered/unordered **lists**, **sup/sub**, and **math** — inline and display — rendered from the
      `data-latex` spans via KaTeX, matching the authoring preview exactly.
- [ ] **Sanitise before render** to a whitelist: `p,br,strong,em,u,sup,sub,ul,ol,li,table,thead,
tbody,tr,td,th,img[src|alt],span[data-type|data-latex]`. Anything else is stripped; author
      script never runs. Sanitising is one util both stem and options pass through.
- [ ] Options reuse the same renderer for their text; the selected-option affordance is unchanged
      (the seam and tokens come later — here, only the content rendering changes).
- [ ] Tests: the pure parts — the sanitiser drops a `<script>`/`onerror` and keeps a whitelisted
      table; the `data-latex` → KaTeX transform produces markup for a valid expression and degrades
      without throwing on a bad one. The visual result is a manual check against a golden question.
      **Acceptance:** a question with an image, a table and an equation renders in EN + HI + TE
      identically to the authoring preview, and no markup in content can execute.

### RT2 — A golden rendering corpus (dev-only)

**Risk:** normal · **Reviews:** 1
**Exemplar:** `scripts/dev-seed-questions.mjs` (local-DB guard, `--reset`, tag-scoped purge, the
null-then-link currentVersion pattern).
**Files:** create `scripts/dev-seed-golden-questions.mjs`; wire nothing into `db:seed` (dev-only, run
by hand like the dummy pool).

- [ ] ~15–20 hand-built questions that combine the hard cases **in one question**: an inline S3
      image, a table, an inline **and** a display equation, and full EN + HI + TE content and
      options — plus at least one long **RC passage** feeding several sub-questions, and one of each
      option count in use. Real `data-latex` spans and a real (or MinIO-seeded) image URL.
- [ ] Tagged `golden`, id-prefixed `qg_`, local-`DATABASE_URL` guarded, `--reset` purges only the
      `golden` pool. Mapped to real seeded subjects/difficulties so a test can draw or hand-pick them.
      **Acceptance:** the golden questions appear in the bank, a finalized test can include them, and
      they are the visual-QA reference for RT1 and RT5.

---

## P3B-S2 — The seam

### RT3 — The engine / template contract + registry

**Risk:** HIGH · **Reviews:** 2
**Exemplar:** `apps/test/src/routes/exam.tsx` (the behaviour to preserve verbatim);
`apps/test/src/lib/use-attempt-state.ts` (the state the engine already owns).
**Files:** create `apps/test/src/components/exam/engine/` (the view-model + the template contract
types + the registry) and `apps/test/src/components/exam/templates/default/` (instance #1); refactor
`apps/test/src/routes/exam.tsx` to drive a template through the contract.

- [ ] Extract an **engine view-model**: from `use-attempt-state` + the paper + the clock, expose
      everything a skin needs to render and every callback it needs to call (open question, record
      answer, mark, clear, change section, submit, the palette counts, reachable sections, remaining
      time source). The engine imports no skin.
- [ ] Define the **template contract**: a typed set of slot components — `Header`, `SectionBar`,
      `QuestionPanel` (wraps the RT1 renderer), `OptionList`, `Palette`, `BottomBar`, `Timer`,
      `Watermark` — each receiving the view-model, plus a `layout` that composes them. A **registry**
      maps a template id → its slot set + layout.
- [ ] The **current monolithic screen becomes template instance #1** ("default"), moved behind the
      contract with its markup intact. Behaviour must not change — the existing full sitting is the
      proof.
- [ ] Tests: the pure view-model derivations (remaining time from `endsAt`, palette counts from the
      state map, which sections are reachable under a sectional clock) keep their coverage. The screen
      itself is a manual check — say what to click.
      **Acceptance:** a full sectional-timed bilingual sitting still runs unchanged; the engine module
      imports no template and a template module imports no Redis/mutation.

---

## P3B-S3 — The two skins

### RT4 — Exam-template token namespace + `Test.examTemplate`

**Risk:** normal · **Reviews:** 1 (schema change ⇒ migration + `db:check`)
**Exemplar:** `packages/ui/src/tokens.css` §7 (the exam block to namespace); how `languageMode`
threads schema → contract → `ExamPaper` (`apps/api/src/attempts/attempt-paper.service.ts`).
**Files:** modify `packages/ui/src/tokens.css`; `prisma/schema.prisma` (+ migration);
`packages/contracts/src/*` (enum + paper DTO); `apps/api/src/attempts/attempt-paper.service.ts`;
`apps/api/src/configs/*` and the base-config admin form for the default.

- [ ] Re-scope the single `--exam-*` set into per-template blocks under
      `[data-exam-template="comfortable"]` and `[data-exam-template="strict"]` (both light + dark),
      and add the tokens the skins vary: **watermark** (text source, colour, opacity, angle),
      **selected-option** bg/border, **section-switch** affordance, and **timer** colour + the config
      hooks for position and format. No raw hex leaves this file.
- [ ] Add `ExamTemplate` enum (`COMFORTABLE`, `STRICT`) — `BaseConfig.examTemplate` with a default,
      `Test.examTemplate` copied at creation (mirror `languageMode`), migration, contract, and carry
      it on `ExamPaper`.
      **Acceptance:** flipping the data-attribute swaps every exam colour with zero component edit;
      `ExamPaper` carries `examTemplate`; each config resolves exactly one default.

### RT5 — Two behaviourally-identical templates

**Risk:** normal · **Reviews:** 1
**Exemplar:** RT3's template contract + the "default" instance; RT4's token namespace.
**Files:** `apps/test/src/components/exam/templates/comfortable/` and `…/strict/`; register both;
select by `ExamPaper.examTemplate`.

- [ ] **Comfortable** — the polished default (generous spacing, larger targets, soft contrast, smooth
      palette/section transitions), still CBT-shaped. Design latitude here.
- [ ] **Strict** — the austere real-CBT baseline (dense spacing, hard edges, minimal motion,
      utilitarian type), drawing only from the constrained token range. This is the one the operator
      re-skins to an exact exam.
- [ ] Both are **behaviourally identical** — same view-model, same state machine, same clock. What
      differs is tokens + config: `timerPosition`/`timerFormat`, `palettePosition`, `sectionSwitch`,
      and the **watermark** (candidate id, backside) are config values a skin reads, not forks.
      **Acceptance:** switching `Test.examTemplate` swaps the entire look with zero engine change;
      each skin runs a full sitting identically; every item the operator configures — watermark
      backside, selected-option colour, marked-for-review, section switching, timer place/format — is
      a token/config value, never a hardcoded style.

---

## P3B-S4 — Close out

### RT6 — Integration = engine plan's T8, plus the template milestone

**Risk:** — · **Reviews:** 1
**Files:** `apps/api/test/*` (the end-to-end walk); no new surface.

- [ ] The engine plan's **open T8**: end-to-end through the fakes — catalog → start → answer →
      autosave → flush → submit → scoring job enqueued once — the one place the attempt services meet.
- [ ] Invariants confirmed by test where possible and by grep where not: no Postgres write on the
      answer path, no answer key in any student payload, the client never computing a deadline, no
      raw hex in an exam component, no unsanitised `dangerouslySetInnerHTML`.
- [ ] The **template milestone**: the same sitting renders in Comfortable and in Strict, and the
      golden corpus (image + table + math + EN/HI/TE) renders faithfully in both. Manual, scripted:
      say exactly what to open and click.
- [ ] Full gates green from a clean checkout; `pnpm db:check` clean.
- [ ] One commit: `chore(exam): phase-3 templates + faithful rendering, end-to-end green`.
      **Acceptance:** the Phase-3 milestone is demonstrable in both skins on real hard content, and
      every invariant above holds.

---

## Session prompts

### P3B-S1 — render the hard content

```
Run Phase-3B Session S1 — render the hard content. Execute RT1, RT2. Binding: CLAUDE.md,
docs/superpowers/task-constraints.md, WORKFLOW.md, prisma/schema.prisma, the ui-conventions skill.
Model: opus. Lean loop. HIGH STAKES on RT1 — 2 reviews.
- RT1 (HIGH,2): one shared exam content renderer — images, tables (own overflow-x), lists, sup/sub,
  and data-latex math via KaTeX matching the authoring preview, both themes, EN/HI/TE, DUAL both.
  Sanitise to a tag/attr whitelist before render; no author script runs. Reuse rich-text.tsx +
  question-math.ts patterns; do not add a second math path.
- RT2 (normal,1): scripts/dev-seed-golden-questions.mjs — ~15-20 questions combining image+table+
  inline&display math+EN/HI/TE (+ one RC passage), tag 'golden', qg_ ids, local-guarded, --reset.
Intent check before each. One commit per task.
```

### P3B-S2 — the seam

```
Run Phase-3B Session S2 — the seam. Execute RT3. Binding + lean loop + opus. HIGH STAKES — 2 reviews.
- RT3 (HIGH,2): extract an engine view-model from use-attempt-state + paper + clock, and a typed
  template contract (Header, SectionBar, QuestionPanel[wraps RT1], OptionList, Palette, BottomBar,
  Timer, Watermark) + a registry keyed by template id. Move the current monolithic screen behind the
  contract as instance #1 with markup intact — no behaviour change; the existing sitting is the proof.
  Engine imports no template; a template imports no Redis/mutation.
Intent check first. One commit.
```

### P3B-S3 — the two skins

```
Run Phase-3B Session S3 — the two skins. Execute RT4, RT5. Binding + lean loop + opus.
- RT4 (normal,1; migration): namespace tokens.css §7 under [data-exam-template="comfortable"|"strict"]
  (light+dark), add watermark/selected-option/section-switch/timer tokens; add ExamTemplate enum,
  BaseConfig.examTemplate default + Test.examTemplate (mirror languageMode) + migration + carry on
  ExamPaper. No raw hex in components.
- RT5 (normal,1): Comfortable (polished) + Strict (austere) as two registered instances over RT3's
  contract, behaviourally identical, differing only by tokens + config (timer position/format,
  palette position, section switch, watermark). Switching Test.examTemplate swaps the whole look.
Intent check before each. One commit per task.
```

### P3B-S4 — close out

```
Run Phase-3B Session S4 — close out. Execute RT6. Binding + opus.
- RT6 (—,1): the engine plan's open T8 (end-to-end catalog→start→answer→flush→submit, one scoring
  enqueue) + invariant greps (no PG on answer path, no answer key in payload, no client deadline, no
  raw hex, no unsanitised innerHTML) + the template milestone (same sitting in both skins; golden
  corpus faithful in both). Gates + db:check green.
One commit: chore(exam): phase-3 templates + faithful rendering, end-to-end green.
```

## What still belongs to Phase 4 (unchanged)

Scoring (marks + negative marking in the BullMQ worker), the scored fields on `Attempt`, the Score
Card, the Solution Report, and the live Redis leaderboard for rank + percentile. Every data point
they need — option chosen, state, time per question — is already captured, so none of it requires
re-instrumenting. The per-attempt GENERATED draw and the `StudentSeriesUnlock`/`ACCESS_CATALOG_CHANGED`
leftover also remain for whoever touches them next.
