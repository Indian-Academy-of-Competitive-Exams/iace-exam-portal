# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo: what this project is, and what to read
next. It is a map, not a reference — the data model is `prisma/schema.prisma`, it is not summarised
anywhere, and it **wins over every document here.**

<binding-core>

The binding core — gates, commit rules, invariants, API, code style, tests — lives in one file,
imported here. **Never restate it below.**

@docs/superpowers/task-constraints.md

Before any task, follow `docs/superpowers/WORKFLOW.md` (the lean loop: batching, review-by-risk,
terse reports, tests as intent not code).

</binding-core>

## What this is

A learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE,
SI/Constable), replacing ThinkExam.

- **V1 = the mock-test feature.** One developer + AI pair, ~45 days.
- **Scale:** ~2K concurrent normal, handle 4K, 5K with minor infra additions. Not 10K.
- **Portals:** **Test** (`apps/test`, V1) and **Admin** (`apps/admin`, V1); a broad Student portal later.
- **Rollout:** internal IACE students first, by branch and enrolment; public later.

## Tech stack (locked)

**`docs/01-architecture.md` §2 is the list**, every choice with its reason beside it — NestJS API,
Vite + React SPAs, PostgreSQL via Prisma, Redis + BullMQ, S3, self-built JWT auth, no WebSockets.
It is the only copy; nothing here restates it.

One auth rule no table can carry: a student's **4-digit PIN is not unique across students**, and is
only ever checked against the one student a mobile resolves to. A `@unique` on it would cap the
platform at 10,000 students.

<scaling-rules>

Do not break these — they are why the live test holds at 4–5K:

- Timer is client-side; the server owns `startedAt`/`endsAt`.
- Autosave answers to Redis every ~20–30s. Never write Postgres per keystroke.
- On submit, enqueue a BullMQ scoring job. Workers evaluate, update the Redis leaderboard, write
  durable scored fields.
- Read rank/percentile live from Redis. There is no "regenerate" step.

</scaling-rules>

## Where things live

- `prisma/schema.prisma` — the data model, and the target of record for every claim about it.
- `docs/01-architecture.md` — what the system is: the locked stack and why each piece, the V1
  boundary, the service diagram, live-test scaling, the deployment topology.
- `docs/02-domain-rules.md` — the rules the schema cannot state: the catalog and the blueprint,
  building and finalizing a test, lock on first attempt, access, scheduling, the sitting, results
  and ranking, rollups, render modes and skins, the question bank, question import.
- `docs/03-conventions.md` — where code goes: packaging, module boundaries, the table-ownership map,
  the event catalog, service tiers, and what CI mechanically enforces. Its section numbers are an
  interface that source comments cite, so renumbering is a breaking change.
- `docs/design/design-system.html` — living style guide, and the **admin** composition language.
- `docs/design/student/README.md` — the **student** composition language for `apps/test`.
  One token set, two compositions; `ui-conventions` marks the bullets that differ.
- `.claude/skills/ui-conventions/` — the binding UI rules. The constraints file above says when to
  invoke it; this is where it lives.
- `graft/` — the wiring graph of every TypeScript and JavaScript file, queried with the `graft` CLI
  or the `graft` skill. Git-ignored, so run `graft build` once in a fresh clone.
- `packages/ui/src/index.ts` — the component inventory.
- `packages/app-kit/` — SPA plumbing (tokens/session, API client, form errors, page size).
- `pnpm docs:check` — the doc-drift report, on a schedule and gating nothing (`docs/03` §12).
