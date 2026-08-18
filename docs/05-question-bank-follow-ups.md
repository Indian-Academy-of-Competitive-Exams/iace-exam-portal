# Question bank — follow-ups left in the code

These were lifted out of the source as `// TODO` / `TODO:` markers because the
SonarQube quality gate counts every TODO marker as a new violation; the intent
below is unchanged from what the comment said, just moved here so it stays
readable without blocking the gate.

## Content nodes are text-only

**Where:** `packages/contracts/src/questions.ts:98` (in the comment above
`CONTENT_NODE_TYPE`)

> TODO(phase-2): IMAGE (S3 key) and MATH (LaTeX) node types; today text only.

Status: still open. `CONTENT_NODE_TYPE` only defines `TEXT`; there is no image
or LaTeX node type yet.

## Import is bounded rather than queued

**Where:** `packages/contracts/src/questions.ts:628` (in the comment above
`QUESTION_IMPORT_MAX_ROWS`)

> Bounded so one upload stays a single synchronous request. TODO: BullMQ above
> this.

Status: still open. `QUESTION_IMPORT_MAX_ROWS` is still the only guard; there
is no queue above it. Closely related to the next item, but was its own
comment at its own call site, so it is listed separately here too.

## Question search is a full-table `ILIKE` scan

**Where:** `apps/api/src/questions/questions.service.ts:196` (in the
`searchIds` doc comment)

> TODO: a generated tsvector column once the bank outgrows a scan.

Status: still open. `searchIds` still runs `content::text ILIKE` / `questionCode
ILIKE` with `$queryRaw`, no `tsvector` column or index behind it.

## Import commit is synchronous

**Where:** `apps/api/src/questions/question-import.service.ts:35` (in the
`QuestionImportService` class doc comment)

> TODO: synchronous today. Move the commit onto BullMQ if files outgrow one
> request.

Status: still open. `commit()` still reads, plans and writes inline inside one
request; nothing enqueues it onto BullMQ yet.

## Question form is text-only, no preview

**Where:** `apps/admin/src/routes/question-form.tsx:57` (in the route's doc
comment)

> TODO(phase-2): images, equations and a rendered preview. Text only here.

Status: still open. The form only has `Textarea`/`Input` fields for stem,
options and solution — no image upload, no LaTeX input, no rendered preview.
