# Settable access model — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin somewhere to set every column the access model needs — exam types, group typing and branch catalog, and a student's type, enrolments and branch — so the resolver slice has real data to resolve.

**Architecture:** Three commits, in order. The first creates the `configs` module that owns `ExamType` (the module `docs/03` §5 already assigns it to), its migration, its screen, and the `MultiCombobox` the next two commits need. The second rewrites the group write path onto `type`/`examType`/`branchIds`, makes student counts type-aware, and closes the four paths that can hand out a direct grant. The third adds the student Access card and repoints "deactivate" from `isActive` onto `isTestBlocked`, making that flag visible on the roster and in the student portal.

**Tech Stack:** TypeScript everywhere. NestJS + Prisma/Postgres (`apps/api`), Vite + React SPAs (`apps/admin`, `apps/test`), zod contracts and a typed client (`packages/contracts`), Tailwind + shadcn design system (`packages/ui`), react-hook-form, TanStack Query, `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-08-18-settable-access-model-design.md` — binding, and the source of every decision below.

## Global Constraints

Every task's requirements implicitly include this section.

- **Read first, they are binding:** `CLAUDE.md`, `docs/03-shared-architecture.md`, `docs/04-students-groups-access-model.md`, `prisma/schema.prisma` (which wins on any data-model conflict), and the spec above.
- **Prerequisite, once, before Task 1:** `pnpm exec prisma migrate reset --force --skip-seed --schema prisma/schema.prisma`. The dev data is throwaway and its 3 backfilled `{type: EXAM, examType: null}` groups plus 6 EXAM direct grants are exactly what the new rules refuse. The migrations themselves delete no rows.
- **One commit per section**, made in that section's final task, never before. Intermediate tasks stage nothing.
- **Gates, green per commit:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the migrations path (`pnpm db:migrate:deploy` from scratch and `pnpm db:check`).
- **Node 22 in the shell that commits** (`source ~/.nvm/nvm.sh && nvm use 22`) — pnpm 11 dies on Node 20.
- **Never push.** No `git push`, no branches, no PRs. Commit on the current branch.
- **Never `--no-verify`, never `git commit -n`, never `SKIP_SONAR=1`.** The pre-commit hook runs a real SonarQube scan (project key `iace-platform`) and enforces the gate. Fix the cause, or say what is blocking.
- **The `questions.ts` nuisance:** the untracked `packages/contracts/src/questions.ts` trips the gate (`typescript:S3776`, complexity 20 at line 228). Every commit task moves it aside (`cp` to a temp path, `rm`) before committing and restores it byte-identical afterwards — sha `035d7a2e`. It is not ours to fix.
- **Never `git add -A` blind.** Check `git status` first, stage whole files, run prettier first, and `git diff --stat` must be empty after `git add`.
- **Commit subject:** `type(scope): what changed, in plain words`. The body carries the why and what the change prevents. **No `Co-Authored-By` and no tool attribution anywhere.**
- **Tests ship in the same commit as the feature.** `node:test` + `node:assert/strict`, named after the unit (`exam-type-rules.unit.test.ts`), no Postgres/Redis/S3 — extend `apps/api/test/support/fakes.ts`. Cover the happy path **and** the failure the feature exists to prevent.
- **Code style:** default to no comment (only an external constraint, a line that looks wrong and is not, or an invariant the types cannot carry; two lines hard cap, never what changed). No magic strings — `SCREAMING_SNAKE_CASE` const objects, `as const`. Design values from `packages/ui` tokens, never a raw hex.
- **Check `packages/ui` and `packages/app-kit` before writing any UI.** A component two screens need belongs in `packages/ui` (`shared-components.test.ts` enforces it).
- **API:** one envelope; controllers return data or throw `AppException(ErrorCodes.X, …)`; react to `error.code`, never a message string.
- **Confirm before anything destructive** with `ConfirmDialog`, naming the consequence and the count. A toggle confirms in both directions.

---

### Task 1: Migration A — canonical exam-type codes and `isActive`

**Files:**
Create: `prisma/migrations/20260818110000_exam_type_codes_and_state/migration.sql`
Modify: `prisma/schema.prisma` (`model ExamType` at lines 483–493 — the soft-delete convention block is left alone, see Step 1)
Test: none — verified by `prisma migrate diff --exit-code` and a from-scratch `migrate deploy`

**Interfaces:**
Consumes: the existing `ExamType_code_key` unique index (`prisma/migrations/20260810125612_init/migration.sql:414`)
Produces: `ExamType { code String @unique (non-null), isActive Boolean @default(true) }`

- [ ] **Step 1: State the target in the schema**

`prisma/schema.prisma`, replace the `ExamType` model (lines 483–493):

```prisma
model ExamType {
  id          String    @id @default(cuid())
  /// UPPERCASE letters/digits, single-spaced — `Group.examType` and
  /// `Student.enrolledExams` store this string, with no relation to follow.
  code        String    @unique
  name        String    @unique
  description String?
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @default(now()) @updatedAt

  baseConfigs BaseConfig[]
  tests       Test[]
}
```

**No `deletedAt`, deliberately.** The convention block at `prisma/schema.prisma:47-48` already records the
decision — "ExamType, BaseConfig, TestSeries — retired by a flag or by cloning" — and until now
`ExamType` had no flag to retire it with. Adding `isActive` makes that sentence true rather than
contradicting it. Leave the convention block untouched.

- [ ] **Step 2: Run the drift check and watch it fail**

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U iace -d iace -c 'CREATE DATABASE iace_shadow' || true
SHADOW_DATABASE_URL='postgresql://iace:iace_dev_password@localhost:5432/iace_shadow?schema=public' pnpm db:check
```

Expected: exit code 2 and a diff naming the two changes —

```
[+] Added columns
  - ExamType.isActive
[*] Changed the `ExamType` table
  [*] Altered column `code` (arity changed from Nullable to Required)
```

- [ ] **Step 3: Write the migration**

`prisma/migrations/20260818110000_exam_type_codes_and_state/migration.sql`:

```sql
-- Exam types become writable: every row carries a canonical `code`, and the
-- catalog gains the two state columns the screen needs.
--
-- `code` is nullable today and no code has ever written it, so it is backfilled
-- from the name, VERIFIED, and only then constrained. The verification is the
-- point: a silent backfill can write a value `examTypeCodeSchema` rejects on
-- every later PATCH, producing a row that can never be edited again.

UPDATE "ExamType" SET "code" = upper(regexp_replace(trim("name"), '\s+', ' ', 'g')) WHERE "code" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ExamType" WHERE "code" !~ '^[A-Z0-9]+( [A-Z0-9]+)*$') THEN
    RAISE EXCEPTION 'ExamType.code cannot be made canonical automatically — fix these rows by hand first';
  END IF;
  IF EXISTS (SELECT 1 FROM "ExamType" GROUP BY "code" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'two exam types canonicalise to the same code';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ExamType" ALTER COLUMN "code" SET NOT NULL;

-- AlterTable
ALTER TABLE "ExamType" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 4: Re-run the drift check, and replay from scratch**

```bash
SHADOW_DATABASE_URL='postgresql://iace:iace_dev_password@localhost:5432/iace_shadow?schema=public' pnpm db:check && echo "no drift"
pnpm exec prisma migrate reset --force --skip-seed --schema prisma/schema.prisma
pnpm db:migrate:deploy
pnpm db:generate
```

Expected: `db:check` exits 0 and prints `no drift`; `migrate deploy` applies all ten migrations with `9 migrations found ... applied`; `db:generate` regenerates the client so `Prisma.ExamTypeWhereInput` exists for Task 5.

---

### Task 2: `packages/contracts/src/exam-types.ts`

**Files:**
Create: `packages/contracts/src/exam-types.ts`, `packages/contracts/test/exam-types.test.ts`
Modify: `packages/contracts/src/index.ts:9` (beside `./branches`), `packages/contracts/src/client.ts:59-66` (import block) and `:535` (after the `branches` group)

**Interfaces:**
Consumes: `paginationQuerySchema` (`./envelope`), `canonicalNameSchema` (`./naming`)
Produces: `EXAM_TYPE_NAME_MAX`, `EXAM_TYPE_CODE_MAX`, `examTypeNameSchema`, `examTypeCodeSchema`, `examTypeSchema`/`ExamType`, `examTypeListQuerySchema`/`ExamTypeListQuery`/`ExamTypeListQueryInput`, `createExamTypeSchema`/`CreateExamTypeInput`/`CreateExamTypeBody`, `updateExamTypeSchema`/`UpdateExamTypeInput`/`UpdateExamTypeBody`, `ADMIN_EXAM_TYPE_ROUTES`, `api.admin.examTypes.{list,create,update,remove}`

- [ ] **Step 1: Write the failing test**

`packages/contracts/test/exam-types.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_EXAM_TYPE_ROUTES,
  createExamTypeSchema,
  examTypeListQuerySchema,
  updateExamTypeSchema,
} from '../src/index';

/**
 * The code is what `Group.examType` and `Student.enrolledExams` store, with no foreign key behind
 * it. A code that is not canonical is a code nothing will ever match again.
 */
describe('createExamTypeSchema', () => {
  it('normalises the code on the way in', () => {
    assert.deepEqual(createExamTypeSchema.parse({ name: 'SSC CGL', code: ' ssc  cgl ' }), {
      name: 'SSC CGL',
      code: 'SSC CGL',
    });
  });

  it('refuses a code that cannot be tidied into the canonical form', () => {
    assert.equal(
      createExamTypeSchema.safeParse({ name: 'SSC CGL', code: 'SSC-CGL' }).success,
      false,
    );
  });

  /** The name is display text — it keeps its case, and only its edges are trimmed. */
  it('trims the name but leaves its shape alone', () => {
    assert.equal(
      createExamTypeSchema.parse({ name: '  RRB Junior Engineer ', code: 'RRB JE' }).name,
      'RRB Junior Engineer',
    );
  });

  it('refuses a name of one character', () => {
    assert.equal(createExamTypeSchema.safeParse({ name: 'S', code: 'SSC' }).success, false);
  });
});

describe('updateExamTypeSchema', () => {
  it('accepts a retire with nothing else in the body', () => {
    assert.deepEqual(updateExamTypeSchema.parse({ isActive: false }), { isActive: false });
  });

  it('canonicalises a code change too, so the refusal is judged on the real value', () => {
    assert.equal(updateExamTypeSchema.parse({ code: 'ssc chsl' }).code, 'SSC CHSL');
  });
});

describe('examTypeListQuerySchema', () => {
  it('reads activeOnly as the boolean the service branches on', () => {
    const query = examTypeListQuerySchema.parse({ page: '1', pageSize: '20', activeOnly: 'true' });
    assert.equal(query.activeOnly, true);
    assert.equal(examTypeListQuerySchema.parse({}).activeOnly, undefined);
  });

  it('drops an empty search rather than filtering on nothing', () => {
    assert.equal(examTypeListQuerySchema.parse({ q: '   ' }).q, undefined);
  });
});

describe('ADMIN_EXAM_TYPE_ROUTES', () => {
  it('addresses one exam type by id', () => {
    assert.equal(ADMIN_EXAM_TYPE_ROUTES.update('ext_1'), '/admin/exam-types/ext_1');
    assert.equal(ADMIN_EXAM_TYPE_ROUTES.remove('ext_1'), '/admin/exam-types/ext_1');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/contracts test
```

Expected: the file fails to load —

```
SyntaxError: The requested module '../src/index' does not provide an export named 'ADMIN_EXAM_TYPE_ROUTES'
```

- [ ] **Step 3: Implement**

`packages/contracts/src/exam-types.ts`:

```ts
import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';

// ============================================================================
// Exam types — the catalog `Group.examType` and `Student.enrolledExams` both
// store BY CODE, with no foreign key. Super admin writes only; anyone managing
// groups reads, because they pick from it.
// ============================================================================

export const EXAM_TYPE_NAME_MAX = 80;
export const EXAM_TYPE_CODE_MAX = 40;

/** Display text — what an admin reads in a list, not what anything stores. */
export const examTypeNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the exam type a name')
  .max(EXAM_TYPE_NAME_MAX, `A name cannot be longer than ${EXAM_TYPE_NAME_MAX} characters`);

/** e.g. SSC CGL, RRB JE. Canonical, because groups and enrolments carry this exact string. */
export const examTypeCodeSchema = canonicalNameSchema({
  max: EXAM_TYPE_CODE_MAX,
  label: 'exam type code',
});

export const examTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  /** Groups pointing at this code — the code cannot change once any exist. */
  groupCount: z.number().int(),
  createdAt: z.string(),
});
export type ExamType = z.infer<typeof examTypeSchema>;

export const examTypeListQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  /** The group and student forms offer active types only; the admin screen shows all. */
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type ExamTypeListQuery = z.infer<typeof examTypeListQuerySchema>;
export type ExamTypeListQueryInput = z.input<typeof examTypeListQuerySchema>;

export const createExamTypeSchema = z.object({
  name: examTypeNameSchema,
  code: examTypeCodeSchema,
});
export type CreateExamTypeInput = z.input<typeof createExamTypeSchema>;
export type CreateExamTypeBody = z.infer<typeof createExamTypeSchema>;

/** The code is refused server-side once anything references it — see `examTypeEditBlocker`. */
export const updateExamTypeSchema = z.object({
  name: examTypeNameSchema.optional(),
  code: examTypeCodeSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateExamTypeInput = z.input<typeof updateExamTypeSchema>;
export type UpdateExamTypeBody = z.infer<typeof updateExamTypeSchema>;

export const ADMIN_EXAM_TYPE_ROUTES = {
  list: '/admin/exam-types',
  create: '/admin/exam-types',
  update: (id: string) => `/admin/exam-types/${id}`,
  remove: (id: string) => `/admin/exam-types/${id}`,
} as const;
```

`packages/contracts/src/index.ts`, after line 9 (`export * from './branches';`):

```ts
export * from './exam-types';
```

`packages/contracts/src/client.ts`, after the `./branches` import block (line 66):

```ts
import {
  ADMIN_EXAM_TYPE_ROUTES,
  examTypeSchema,
  type CreateExamTypeInput,
  type ExamType,
  type ExamTypeListQueryInput,
  type UpdateExamTypeInput,
} from './exam-types';
```

and, inside `admin`, immediately after the `branches: { … },` group (line 535):

```ts
      examTypes: {
        list: (query: ExamTypeListQueryInput = {}): Promise<Paginated<ExamType>> =>
          requestPaginated(`${ADMIN_EXAM_TYPE_ROUTES.list}${queryString({ ...query })}`, {
            schema: examTypeSchema.array(),
          }),

        create: (input: CreateExamTypeInput): Promise<ExamType> =>
          request(ADMIN_EXAM_TYPE_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: examTypeSchema,
          }),

        update: (id: string, input: UpdateExamTypeInput): Promise<ExamType> =>
          request(ADMIN_EXAM_TYPE_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: examTypeSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_EXAM_TYPE_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),
      },
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/contracts test && pnpm --filter @iace/contracts typecheck
```

Expected: `# pass 9`, `# fail 0` for the new file and no type errors.

---

### Task 3: `exam-type-rules.ts` — the two blockers

**Files:**
Create: `apps/api/src/configs/exam-type-rules.ts`, `apps/api/test/exam-type-rules.unit.test.ts`

**Interfaces:**
Consumes: nothing — pure, prisma-free, in the shape of `apps/api/src/branches/branch-rules.ts`
Produces: `interface ExamTypeUsage { groupCount, studentCount, baseConfigCount, testCount }`; `examTypeDeletionBlocker(usage: ExamTypeUsage): string | null`; `examTypeEditBlocker(usage: ExamTypeUsage, changes: { name?: string; code?: string; isActive?: boolean }): string | null`; `INACTIVE_EXAM_TYPE_MESSAGE`

- [ ] **Step 1: Write the failing test**

`apps/api/test/exam-type-rules.unit.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  examTypeDeletionBlocker,
  examTypeEditBlocker,
  type ExamTypeUsage,
} from '../src/configs/exam-type-rules';

const unused: ExamTypeUsage = {
  groupCount: 0,
  studentCount: 0,
  baseConfigCount: 0,
  testCount: 0,
};

describe('examTypeDeletionBlocker', () => {
  it('allows deleting an exam type nothing points at', () => {
    assert.equal(examTypeDeletionBlocker(unused), null);
  });

  /**
   * The failure this exists to prevent: `BaseConfig.examTypeId` CASCADEs and takes its sections
   * with it, so one delete destroys every blueprint under the exam type.
   */
  it('refuses one that still has base configs, and says how many', () => {
    const blocker = examTypeDeletionBlocker({ ...unused, baseConfigCount: 2 });
    assert.match(blocker ?? '', /2 base configs/);
  });

  /** `Test.examTypeId` and `Test.baseConfigId` both SET NULL — the tests survive, orphaned. */
  it('refuses one that still has tests', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, testCount: 7 }) ?? '', /7 tests/);
  });

  it('names every holder at once, so the admin is not told one at a time', () => {
    const blocker =
      examTypeDeletionBlocker({
        groupCount: 3,
        studentCount: 40,
        baseConfigCount: 1,
        testCount: 0,
      }) ?? '';
    assert.match(blocker, /3 groups/);
    assert.match(blocker, /40 enrolled students/);
    assert.match(blocker, /1 base config\b/);
    assert.doesNotMatch(blocker, /0 tests/);
  });

  it('reads naturally for a single group', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, groupCount: 1 }) ?? '', /1 group\b/);
  });

  it('offers retiring as the way out', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, groupCount: 1 }) ?? '', /[Rr]etire/);
  });
});

describe('examTypeEditBlocker', () => {
  it('leaves a rename and a retire alone, however much is attached', () => {
    const busy: ExamTypeUsage = {
      groupCount: 9,
      studentCount: 400,
      baseConfigCount: 3,
      testCount: 12,
    };
    assert.equal(examTypeEditBlocker(busy, { name: 'SSC Combined Graduate Level' }), null);
    assert.equal(examTypeEditBlocker(busy, { isActive: false }), null);
    assert.equal(examTypeEditBlocker(busy, {}), null);
  });

  it('allows a code change while nothing references it', () => {
    assert.equal(
      examTypeEditBlocker({ ...unused, baseConfigCount: 4 }, { code: 'SSC CHSL' }),
      null,
    );
  });

  /**
   * The failure this exists to prevent, and the only reason the blocker exists: `Group.examType`
   * and `Student.enrolledExams` hold the CODE as free text with no foreign key. Changing it detaches
   * every group and every enrolment — no error, no rows changed, no way to notice.
   */
  it('refuses a code change once groups carry it', () => {
    const blocker = examTypeEditBlocker({ ...unused, groupCount: 2 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /2 groups/);
    assert.match(blocker ?? '', /detach/);
  });

  it('refuses a code change once students are enrolled under it', () => {
    const blocker = examTypeEditBlocker({ ...unused, studentCount: 118 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /118 enrolled students/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/api test 2>&1 | tail -20
```

Expected:

```
Error: Cannot find module '.../apps/api/src/configs/exam-type-rules'
```

- [ ] **Step 3: Implement**

`apps/api/src/configs/exam-type-rules.ts`:

```ts
/** The rules that keep the exam-type catalog trustworthy. */

export interface ExamTypeUsage {
  groupCount: number;
  studentCount: number;
  baseConfigCount: number;
  testCount: number;
}

function countOf(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * All four counts matter: a base config cascades and takes its sections with it, and a test
 * reachable only through a config is invisible to a count on `Test.examTypeId` alone.
 */
export function examTypeDeletionBlocker(usage: ExamTypeUsage): string | null {
  const held = [
    countOf(usage.groupCount, 'group'),
    countOf(usage.studentCount, 'enrolled student'),
    countOf(usage.baseConfigCount, 'base config'),
    countOf(usage.testCount, 'test'),
  ].filter((part): part is string => part !== null);

  if (held.length === 0) return null;
  return `This exam type is still used by ${held.join(', ')}. Retire it instead — a retired exam type keeps everything it has and is simply no longer offered.`;
}

/**
 * `Group.examType` and `Student.enrolledExams` store the code as free text with no foreign key, so
 * a rename would detach every one of them with no error and no rows changed.
 */
export function examTypeEditBlocker(
  usage: ExamTypeUsage,
  changes: { name?: string; code?: string; isActive?: boolean },
): string | null {
  if (changes.code === undefined) return null;

  const attached = [
    countOf(usage.groupCount, 'group'),
    countOf(usage.studentCount, 'enrolled student'),
  ].filter((part): part is string => part !== null);

  if (attached.length === 0) return null;
  return `${attached.join(' and ')} already store this code, and nothing links them back to this row — changing it would detach every one of them silently. Create a second exam type instead.`;
}

export const INACTIVE_EXAM_TYPE_MESSAGE =
  'That exam type is no longer active. Pick another, or reactivate it first.';
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/api test 2>&1 | tail -20
```

Expected: `# pass` rises by 11, `# fail 0`.

---

### Task 4: The two facades, and the fakes that let them be tested

**Files:**
Modify: `apps/api/src/groups/groups.service.ts` (after `detail`, line 84), `apps/api/src/students/students.service.ts` (after `assertExists`, line 238), `apps/api/test/support/fakes.ts` (`FakeStudent` 254–271, `makeStudent` 294–314, `StudentWhere` 343–355, `FakePrisma` constructor 361–366, `group.count` 460–465, and a new `examType` facade + `FakeExamType`)
Test: `apps/api/test/module-facades.unit.test.ts` (append)

**Interfaces:**
Produces: `GroupsService.countByExamType(code: string): Promise<number>`; `GroupsService.countsByExamTypes(codes: string[]): Promise<Map<string, number>>`; `StudentsService.countEnrolledIn(code: string): Promise<number>`; `FakeExamType`, `makeExamType`, `FakePrisma.examTypes` (**fifth positional**), `FakePrisma.examType`, `FakePrisma.baseConfigCount`, `FakePrisma.testCount`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/module-facades.unit.test.ts`:

```ts
// --------------------------------------------------------------------------- configs → groups /
// students ---------------------------------------------------------------------------

describe('the counts the configs module asks for', () => {
  /**
   * The failure these prevent: the code lives in `Group.examType` and `Student.enrolledExams` as
   * free text, so `configs` has nothing to join on and would otherwise read the two tables itself.
   */
  it('GroupsService.countByExamType counts groups carrying the code', async () => {
    const prisma = new FakePrisma(
      [],
      [],
      [],
      [
        makeGroup({ id: 'grp_1', examType: 'SSC CGL' }),
        makeGroup({ id: 'grp_2', examType: 'SSC CGL' }),
        makeGroup({ id: 'grp_3', examType: 'RRB JE' }),
      ],
    );
    const groups = new GroupsService(prisma.asService(), null as never);

    assert.equal(await groups.countByExamType('SSC CGL'), 2);
    assert.equal(await groups.countByExamType('SSC CHSL'), 0);
  });

  it('StudentsService.countEnrolledIn counts students enrolled under the code', async () => {
    const prisma = new FakePrisma([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
      makeStudent({ id: 'stu_2', enrolledExams: ['SSC CGL', 'RRB JE'] }),
      makeStudent({ id: 'stu_3', enrolledExams: [] }),
    ]);
    const students = new StudentsService(prisma.asService(), null as never);

    assert.equal(await students.countEnrolledIn('SSC CGL'), 2);
    assert.equal(await students.countEnrolledIn('RRB JE'), 1);
    assert.equal(await students.countEnrolledIn('SSC CHSL'), 0);
  });
});
```

and extend its import from `./support/fakes` to `{ FakeConfig, FakePrisma, FakeRedis, makeBranch, makeGroup, makeStudent }`, plus `import { GroupsService } from '../src/groups';`.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/api test 2>&1 | grep -A4 'the counts the configs module'
```

Expected:

```
not ok 1 - GroupsService.countByExamType counts groups carrying the code
  error: 'groups.countByExamType is not a function'
```

- [ ] **Step 3: Implement**

`apps/api/src/groups/groups.service.ts`, immediately after `detail` (line 84):

```ts
  /** For the configs module: `Group.examType` stores the code, with no relation to follow. */
  countByExamType(code: string): Promise<number> {
    return this.prisma.group.count({ where: { examType: code } });
  }

  /** The same count for a whole page of codes, in one query rather than one per row. */
  async countsByExamTypes(codes: string[]): Promise<Map<string, number>> {
    if (codes.length === 0) return new Map();

    const rows = await this.prisma.group.groupBy({
      by: ['examType'],
      where: { examType: { in: codes } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.examType ?? '', row._count._all]));
  }
```

`apps/api/src/students/students.service.ts`, immediately after `assertExists` (line 238):

```ts
  /** For the configs module: enrolment is an array of exam-type CODES, with no relation to follow. */
  countEnrolledIn(code: string): Promise<number> {
    return this.prisma.student.count({ where: { enrolledExams: { has: code } } });
  }
```

`apps/api/test/support/fakes.ts` — five edits.

(a) `FakeStudent` gains the column, after `directGroupIds` (line 270):

```ts
  /** The exam-type codes this student is enrolled under — the column, as Prisma stores it. */
  enrolledExams: string[];
```

and `makeStudent` gains `enrolledExams: [],` beside `directGroupIds: []` (line 311).

(b) `StudentWhere` and `matchesStudent` (lines 343–355):

```ts
/** The student filters the fakes answer: two `in` lookups, a grant lookup and an enrolment lookup. */
interface StudentWhere {
  id?: { in: string[] };
  mobile?: { in: string[] };
  directGroupIds?: { has: string };
  enrolledExams?: { has: string };
}

function matchesStudent(student: FakeStudent, where: StudentWhere): boolean {
  return (
    (where.id?.in ? where.id.in.includes(student.id) : true) &&
    (where.mobile?.in ? where.mobile.in.includes(student.mobile) : true) &&
    (where.directGroupIds ? student.directGroupIds.includes(where.directGroupIds.has) : true) &&
    (where.enrolledExams ? student.enrolledExams.includes(where.enrolledExams.has) : true)
  );
}
```

(c) The constructor (lines 361–366) — `examTypes` goes **fifth and last**:

```ts
  constructor(
    readonly students: FakeStudent[] = [],
    readonly admins: FakeAdmin[] = [],
    readonly branches: FakeBranch[] = [],
    readonly groups: FakeGroup[] = [],
    // FIFTH, and nowhere else: every existing call is positional, so an earlier
    // slot silently rebinds four arrays across nine call sites with no type error.
    readonly examTypes: FakeExamType[] = [],
  ) {}

  /** Set by a test that needs the exam-type deletion blocker to see a blueprint or a test. */
  baseConfigCount = 0;
  testCount = 0;
```

(d) `group.count` (lines 460–465) learns the one filter the new facade uses:

```ts
    groupBy: ({ where = {} }: { where?: { examType?: { in: string[] } } } = {}) => {
      const wanted = where.examType?.in;
      const counts = new Map<string, number>();
      for (const g of this.groups) {
        if (g.examType === null) continue;
        if (wanted && !wanted.includes(g.examType)) continue;
        counts.set(g.examType, (counts.get(g.examType) ?? 0) + 1);
      }
      return Promise.resolve(
        [...counts].map(([examType, total]) => ({ examType, _count: { _all: total } })),
      );
    },

    count: ({ where = {} }: { where?: { id?: { in: string[] }; examType?: string } } = {}) =>
      Promise.resolve(
        this.groups.filter(
          (g) =>
            (where.id?.in ? where.id.in.includes(g.id) : true) &&
            (where.examType === undefined || g.examType === where.examType),
        ).length,
      ),
```

(e) The exam-type facade, after the `branch` block (line 497):

```ts
  /** Exam types, with the list filters and the CRUD `ExamTypesService` runs. */
  readonly examType = {
    findUnique: ({ where }: { where: { id?: string; name?: string; code?: string } }) =>
      Promise.resolve(this.examTypes.find((e) => matchesExamTypeKey(e, where)) ?? null),

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: ExamTypeWhere; skip?: number; take?: number } = {}) => {
      const matched = this.examTypes.filter((e) => matchesExamType(e, where));
      return Promise.resolve(matched.slice(skip, take === undefined ? undefined : skip + take));
    },

    count: ({ where = {} }: { where?: ExamTypeWhere } = {}) =>
      Promise.resolve(this.examTypes.filter((e) => matchesExamType(e, where)).length),

    create: ({ data }: { data: { name: string; code: string } }) => {
      const created = makeExamType({ ...data, id: `ext_new_${this.nextId++}` });
      this.examTypes.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const examType = this.examTypes.find((e) => e.id === where.id);
      if (!examType) throw new Error(`no exam type ${where.id}`);
      Object.assign(examType, data);
      return Promise.resolve(examType);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.examTypes.findIndex((e) => e.id === where.id);
      const [removed] = this.examTypes.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** Nothing in this slice writes them; the deletion blocker only ever reads a count. */
  readonly baseConfig = { count: () => Promise.resolve(this.baseConfigCount) };
  readonly test = { count: () => Promise.resolve(this.testCount) };
```

and, beside `makeBranch` (after line 527):

```ts
export interface FakeExamType {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
}

export function makeExamType(overrides: Partial<FakeExamType> = {}): FakeExamType {
  return {
    id: 'ext_1',
    name: 'SSC CGL',
    code: 'SSC CGL',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface ExamTypeWhere {
  name?: { contains: string; mode?: 'insensitive' };
  code?: { in: string[] };
  isActive?: boolean;
}

function matchesExamType(examType: FakeExamType, where: ExamTypeWhere): boolean {
  return (
    (where.name ? examType.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true) &&
    (where.code ? where.code.in.includes(examType.code) : true) &&
    (where.isActive === undefined || examType.isActive === where.isActive)
  );
}

function matchesExamTypeKey(
  examType: FakeExamType,
  where: { id?: string; name?: string; code?: string },
): boolean {
  if (where.id !== undefined) return examType.id === where.id;
  if (where.name !== undefined) return examType.name === where.name;
  return examType.code === where.code;
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/api test 2>&1 | tail -12 && pnpm --filter @iace/api typecheck
```

Expected: `# fail 0` — the two new cases pass and every existing positional `new FakePrisma(...)` call still binds the same four arrays.

---

### Task 5: `ExamTypesService` — `list` and `create`

**Files:**
Create: `apps/api/src/configs/exam-types.service.ts`, `apps/api/test/exam-types-service.unit.test.ts`

**Interfaces:**
Consumes: `PrismaService`, `GroupsService.countByExamType`, `StudentsService.countEnrolledIn`, `examTypeDeletionBlocker`/`examTypeEditBlocker`/`INACTIVE_EXAM_TYPE_MESSAGE`
Produces: `class ExamTypesService` with `list(query: ExamTypeListQuery): Promise<Paginated<ExamType>>` and `create(body: CreateExamTypeBody): Promise<ExamType>`

- [ ] **Step 1: Write the failing test**

`apps/api/test/exam-types-service.unit.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  examTypeListQuerySchema,
  type ExamTypeListQuery,
} from '@iace/contracts';
import { ExamTypesService } from '../src/configs/exam-types.service';
import { GroupsService } from '../src/groups';
import { StudentsService } from '../src/students';
import { FakeExamType, FakePrisma, makeExamType, makeGroup } from './support/fakes';

/** The catalog, exercised through the service rather than its rule helpers. */
function serviceWith(examTypes: FakeExamType[] = [makeExamType()], groups = [makeGroup()]) {
  const prisma = new FakePrisma([], [], [], groups, examTypes);
  const service = new ExamTypesService(
    prisma.asService(),
    new GroupsService(prisma.asService(), null as never),
    new StudentsService(prisma.asService(), null as never),
  );
  return { service, prisma };
}

const listQuery = (over: Partial<ExamTypeListQuery> = {}): ExamTypeListQuery =>
  examTypeListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

describe('ExamTypesService — listing', () => {
  it('reports the group count each exam type carries', async () => {
    const { service } = serviceWith(
      [makeExamType({ code: 'SSC CGL' })],
      [
        makeGroup({ id: 'grp_1', examType: 'SSC CGL' }),
        makeGroup({ id: 'grp_2', examType: 'SSC CGL' }),
      ],
    );

    const page = await service.list(listQuery());

    assert.equal(page.items[0]?.groupCount, 2);
    assert.equal(page.total, 1);
  });

  it('hides retired types when the caller asks for active ones only', async () => {
    const { service } = serviceWith(
      [
        makeExamType({ id: 'ext_1' }),
        makeExamType({ id: 'ext_2', name: 'OLD', code: 'OLD', isActive: false }),
      ],
      [],
    );

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: true }))).total, 1);
  });

  it('returns dates as strings, never Date objects', async () => {
    const { service } = serviceWith();

    assert.equal(typeof (await service.list(listQuery())).items[0]?.createdAt, 'string');
  });
});

describe('ExamTypesService — creating', () => {
  it('creates an exam type that does not exist yet', async () => {
    const { service, prisma } = serviceWith([], []);

    const created = await service.create({ name: 'SSC CHSL', code: 'SSC CHSL' });

    assert.equal(created.code, 'SSC CHSL');
    assert.equal(created.groupCount, 0);
    assert.equal(prisma.examTypes.length, 1);
  });

  /**
   * A CONFLICT the form can show against the field, not a 500 from the unique index — and keyed to
   * `code`, because that is the value every group and enrolment will store.
   */
  it('refuses a duplicate code, against the code field', async () => {
    const { service } = serviceWith([makeExamType({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () => service.create({ name: 'Staff Selection CGL', code: 'SSC CGL' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
  });

  it('refuses a duplicate name, against the name field', async () => {
    const { service } = serviceWith([makeExamType({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () => service.create({ name: 'SSC CGL', code: 'SSC CGL TIER 1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.name);
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/api test 2>&1 | tail -20
```

Expected:

```
Error: Cannot find module '.../apps/api/src/configs/exam-types.service'
```

- [ ] **Step 3: Implement**

`apps/api/src/configs/exam-types.service.ts`:

```ts
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CreateExamTypeBody,
  type ExamType,
  type ExamTypeListQuery,
  type Paginated,
  type UpdateExamTypeBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from '../groups';
import { StudentsService } from '../students';
import {
  examTypeDeletionBlocker,
  examTypeEditBlocker,
  INACTIVE_EXAM_TYPE_MESSAGE,
  type ExamTypeUsage,
} from './exam-type-rules';

interface ExamTypeRow {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
}

/** Owns `ExamType` (docs/03 §5) — the only module that writes it. */
@Injectable()
export class ExamTypesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GroupsService)) private readonly groups: GroupsService,
    @Inject(forwardRef(() => StudentsService)) private readonly students: StudentsService,
  ) {}

  async list(query: ExamTypeListQuery): Promise<Paginated<ExamType>> {
    const where: Prisma.ExamTypeWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.examType.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examType.count({ where }),
    ]);

    const groupCounts = await this.groups.countsByExamTypes(rows.map((row) => row.code));

    return {
      items: rows.map((row) => toExamType(row, groupCounts.get(row.code) ?? 0)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(input: CreateExamTypeBody): Promise<ExamType> {
    await this.assertFree(input.name, input.code);

    const examType = await this.prisma.examType.create({
      data: { name: input.name, code: input.code },
    });
    return toExamType(examType, 0);
  }

  private async assertFree(name: string, code: string, exceptId?: string): Promise<void> {
    const [byName, byCode] = await Promise.all([
      this.prisma.examType.findUnique({ where: { name } }),
      this.prisma.examType.findUnique({ where: { code } }),
    ]);

    if (byName && byName.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That exam type already exists', {
        fieldErrors: { name: ['That exam type already exists'] },
      });
    }
    if (byCode && byCode.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That code is already taken', {
        fieldErrors: { code: ['That code is already taken'] },
      });
    }
  }
}

function toExamType(row: ExamTypeRow, groupCount: number): ExamType {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isActive: row.isActive,
    groupCount,
    createdAt: row.createdAt.toISOString(),
  };
}
```

Import only what this step uses — `examTypeListQuerySchema`'s types, `AppException`, `ErrorCodes`, `PrismaService`, `GroupsService`, `StudentsService`. The rule helpers arrive in Task 6, which is where they are first called; `@typescript-eslint/no-unused-vars` fails the lint gate on an import added early.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/api test 2>&1 | tail -12
```

Expected: the six new cases pass, `# fail 0`.

---

### Task 6: `ExamTypesService` — `update`, `remove`, `assertUsable`

**Files:**
Modify: `apps/api/src/configs/exam-types.service.ts`
Test: `apps/api/test/exam-types-service.unit.test.ts` (append)

**Interfaces:**
Produces: `update(id: string, body: UpdateExamTypeBody): Promise<ExamType>`; `remove(id: string): Promise<void>`; `assertUsable(codes: string[], fieldKey: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/exam-types-service.unit.test.ts`:

```ts
describe('ExamTypesService — updating', () => {
  it('renames an exam type however much is attached to it', async () => {
    const { service } = serviceWith(
      [makeExamType({ id: 'ext_1', name: 'SSC CGL', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    const updated = await service.update('ext_1', { name: 'SSC Combined Graduate Level' });

    assert.equal(updated.name, 'SSC Combined Graduate Level');
    assert.equal(updated.code, 'SSC CGL');
  });

  it('retires and reactivates one', async () => {
    const { service } = serviceWith([makeExamType({ id: 'ext_1' })], []);

    assert.equal((await service.update('ext_1', { isActive: false })).isActive, false);
    assert.equal((await service.update('ext_1', { isActive: true })).isActive, true);
  });

  it('changes the code while nothing references it', async () => {
    const { service } = serviceWith([makeExamType({ id: 'ext_1', code: 'SSC CGL' })], []);

    assert.equal((await service.update('ext_1', { code: 'SSC CGL T1' })).code, 'SSC CGL T1');
  });

  /**
   * The failure the edit blocker exists to prevent: nothing links a group back to this row, so a
   * code change is a silent detach of every group and every enrolment.
   */
  it('refuses a code change once a group carries the code', async () => {
    const { service, prisma } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    await assert.rejects(
      () => service.update('ext_1', { code: 'SSC CGL T1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
    assert.equal(prisma.examTypes[0]?.code, 'SSC CGL', 'nothing should have been written');
  });

  it('allows a PATCH that re-sends the code unchanged', async () => {
    const { service } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    assert.equal(
      (await service.update('ext_1', { code: 'SSC CGL', isActive: false })).isActive,
      false,
    );
  });

  it('answers NOT_FOUND for an exam type that is not there', async () => {
    const { service } = serviceWith([], []);

    await assert.rejects(
      () => service.update('nope', { isActive: false }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.NOT_FOUND);
        return true;
      },
    );
  });
});

describe('ExamTypesService — deleting', () => {
  it('deletes an exam type nothing depends on', async () => {
    const { service, prisma } = serviceWith([makeExamType({ id: 'ext_1' })], []);

    await service.remove('ext_1');

    assert.equal(prisma.examTypes.length, 0);
  });

  it('refuses one that still has groups, and says how many', async () => {
    const { service, prisma } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    await assert.rejects(
      () => service.remove('ext_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /1 group\b/);
        return true;
      },
    );
    assert.equal(prisma.examTypes.length, 1, 'nothing should have been deleted');
  });

  /** `BaseConfig.examTypeId` CASCADEs, so this delete would take every blueprint with it. */
  it('refuses one that still has base configs, even with no groups', async () => {
    const { service, prisma } = serviceWith([makeExamType({ id: 'ext_1' })], []);
    prisma.baseConfigCount = 3;

    await assert.rejects(
      () => service.remove('ext_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /3 base configs/);
        return true;
      },
    );
  });
});

describe('ExamTypesService.assertUsable — the seam groups and students come through', () => {
  it('accepts active codes', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL' })], []);

    await assert.doesNotReject(() => service.assertUsable(['SSC CGL'], 'examType'));
    await assert.doesNotReject(() => service.assertUsable([], 'enrolledExams'));
  });

  /** The field key is a parameter: `applyFieldErrors` drops a key the receiving form does not own. */
  it('keys its refusal to the field the caller names', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL', isActive: false })], []);

    const error = await service.assertUsable(['SSC CGL'], 'enrolledExams').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams?.[0]);
    assert.equal(error.fieldErrors?.examType, undefined);
  });

  it('names the codes it could not find', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL' })], []);

    const error = await service
      .assertUsable(['SSC CGL', 'RRB JE'], 'examType')
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.match(error.message, /RRB JE/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/api test 2>&1 | grep -c 'not ok'
```

Expected: `13` failing cases, each `service.update is not a function` / `service.remove is not a function` / `service.assertUsable is not a function`.

- [ ] **Step 3: Implement**

Append to `ExamTypesService`, after `create`:

```ts
  async update(id: string, input: UpdateExamTypeBody): Promise<ExamType> {
    const examType = await this.requireExamType(id);

    // The diff, not the body: a PATCH that re-sends the current code is not a code change, and
    // treating it as one would make the row uneditable forever.
    const changes = {
      ...(input.name !== undefined && input.name !== examType.name ? { name: input.name } : {}),
      ...(input.code !== undefined && input.code !== examType.code ? { code: input.code } : {}),
      ...(input.isActive !== undefined && input.isActive !== examType.isActive
        ? { isActive: input.isActive }
        : {}),
    };

    // Only a code change can be refused, and only the four counts answer that — so an ordinary
    // rename or retire does not pay for them.
    if (changes.code !== undefined) {
      const blocker = examTypeEditBlocker(await this.usageOf(examType), changes);
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, { fieldErrors: { code: [blocker] } });
      }
    }

    if (changes.name !== undefined || changes.code !== undefined) {
      await this.assertFree(changes.name ?? examType.name, changes.code ?? examType.code, id);
    }

    const updated = await this.prisma.examType.update({ where: { id }, data: changes });
    return toExamType(updated, await this.groups.countByExamType(updated.code));
  }

  async remove(id: string): Promise<void> {
    const examType = await this.requireExamType(id);

    const blocker = examTypeDeletionBlocker(await this.usageOf(examType));
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.examType.delete({ where: { id } });
  }

  /**
   * Whether these codes may be attached to. The field key is a PARAMETER: the group form's field is
   * `examType` and the student form's is `enrolledExams`, and `applyFieldErrors` drops the wrong one.
   */
  async assertUsable(codes: string[], fieldKey: string): Promise<void> {
    if (codes.length === 0) return;

    const found = await this.prisma.examType.findMany({ where: { code: { in: codes } } });

    const missing = codes.filter((code) => !found.some((row) => row.code === code));
    if (missing.length > 0) {
      const message = `No such exam type: ${missing.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [fieldKey]: [message] },
      });
    }

    if (found.some((row) => !row.isActive)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_EXAM_TYPE_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_EXAM_TYPE_MESSAGE] },
      });
    }
  }

  private async requireExamType(id: string): Promise<ExamTypeRow> {
    const examType = await this.prisma.examType.findUnique({ where: { id } });
    if (!examType) throw new AppException(ErrorCodes.NOT_FOUND, 'No such exam type');
    return examType;
  }

  private async usageOf(examType: ExamTypeRow): Promise<ExamTypeUsage> {
    const [groupCount, studentCount, baseConfigCount, testCount] = await Promise.all([
      this.groups.countByExamType(examType.code),
      this.students.countEnrolledIn(examType.code),
      this.prisma.baseConfig.count({ where: { examTypeId: examType.id } }),
      this.prisma.test.count({
        where: { OR: [{ examTypeId: examType.id }, { baseConfig: { examTypeId: examType.id } }] },
      }),
    ]);
    return { groupCount, studentCount, baseConfigCount, testCount };
  }
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/api test 2>&1 | tail -12 && pnpm --filter @iace/api typecheck
```

Expected: `# fail 0`, and 19 cases in `exam-types-service.unit.test.ts`.

---

### Task 7: `ExamTypesController` and `ConfigsModule`

**Files:**
Create: `apps/api/src/configs/exam-types.controller.ts`, `apps/api/src/configs/configs.module.ts`, `apps/api/src/configs/index.ts`
Modify: `apps/api/src/app.module.ts:16` (import) and `:45` (imports array)
Test: `apps/api/test/exam-types-service.unit.test.ts` (append a route-gating describe)

**Interfaces:**
Consumes: `Actors`, `RequiresFeature`, `RequiresSuperAdmin`, `SUPER_ADMIN_KEY` (`../common/security`), `ZodBody`/`ZodQuery`
Produces: `ExamTypesController` at `admin/exam-types`; `ConfigsModule`; `apps/api/src/configs/index.ts` exporting `{ ConfigsModule, ExamTypesService }`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/exam-types-service.unit.test.ts` (and add `import 'reflect-metadata';` as the file's first line, plus `import { ExamTypesController } from '../src/configs/exam-types.controller';` and `import { SUPER_ADMIN_KEY } from '../src/common/security';`):

```ts
/**
 * The catalog every group and enrolment validates against is not something a page permission may
 * invent — reading it is open to whoever manages groups, writing it is not.
 */
describe('ExamTypesController — who may write', () => {
  const gatedOn = (handler: keyof ExamTypesController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamTypesController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages groups', () => {
    assert.equal(gatedOn('list'), false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/api test 2>&1 | tail -20
```

Expected:

```
Error: Cannot find module '.../apps/api/src/configs/exam-types.controller'
```

- [ ] **Step 3: Implement**

`apps/api/src/configs/exam-types.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  createExamTypeSchema,
  examTypeListQuerySchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateExamTypeSchema,
  type CreateExamTypeBody,
  type ExamType,
  type ExamTypeListQuery,
  type Paginated,
  type UpdateExamTypeBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ExamTypesService } from './exam-types.service';

/**
 * Exam types. Reading is open to anyone who can manage groups — they pick from the list — while
 * every write is super-admin only, which is the entire reason the catalog exists.
 */
@Controller('admin/exam-types')
@Actors(ActorTypes.ADMIN)
export class ExamTypesController {
  constructor(private readonly examTypes: ExamTypesService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(examTypeListQuerySchema)) query: ExamTypeListQuery,
  ): Promise<Paginated<ExamType>> {
    return this.examTypes.list(query);
  }

  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createExamTypeSchema)) body: CreateExamTypeBody): Promise<ExamType> {
    return this.examTypes.create(body);
  }

  /** The code is refused once any group or enrolment stores it — see `examTypeEditBlocker`. */
  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateExamTypeSchema)) body: UpdateExamTypeBody,
  ): Promise<ExamType> {
    return this.examTypes.update(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.examTypes.remove(id);
  }
}
```

`apps/api/src/configs/configs.module.ts`:

```ts
import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupsModule } from '../groups';
import { StudentsModule } from '../students';
import { ExamTypesController } from './exam-types.controller';
import { ExamTypesService } from './exam-types.service';

/** Owns `ExamType` (docs/03 §5). forwardRef: groups and students will ask it whether a code is usable. */
@Module({
  imports: [PrismaModule, forwardRef(() => GroupsModule), forwardRef(() => StudentsModule)],
  controllers: [ExamTypesController],
  providers: [ExamTypesService],
  exports: [ExamTypesService],
})
export class ConfigsModule {}
```

`apps/api/src/configs/index.ts`:

```ts
/** The configs module's public surface (docs/03 §4.1). `exam-type-rules` stays private. */
export { ConfigsModule } from './configs.module';
export { ExamTypesService } from './exam-types.service';
```

`apps/api/src/app.module.ts`: add `import { ConfigsModule } from './configs';` after line 16, and `ConfigsModule,` after `GroupsModule,` in the imports array.

`docs/03-shared-architecture.md`, in the "Known seams to clean" list (§4, around line 81), add one line —
the repo's own idiom for recording coupling rather than hiding it:

```markdown
- `configs` → `prisma.test.count` for the exam-type deletion blocker. `Test` belongs to the
  tests/builder module, which does not exist yet, so there is no facade to ask. Becomes
  `TestsService.countByExamType` when that module lands. The Group and Student halves of the same
  blocker already route through their owners' facades.
```

- [ ] **Step 4: Run the tests, and boot the app for real**

```bash
pnpm --filter @iace/api test 2>&1 | tail -12
pnpm --filter @iace/api build
```

Expected: `# fail 0`; `nest build` succeeds. Then confirm the module graph resolves rather than only compiling:

```bash
pnpm --filter @iace/api dev 2>&1 | grep -m1 'ExamTypesController'
```

Expected: `[RoutesResolver] ExamTypesController {/admin/exam-types}:` — then stop it.

---

### Task 8: Extract `ComboboxShell` so a second variant is not a copy

**Files:**
Create: `packages/ui/src/components/ui/combobox-shell.tsx`, `packages/ui/test/combobox.dom.test.tsx`
Modify: `packages/ui/src/components/ui/combobox.tsx` (whole file)

**Interfaces:**
Produces: `ComboboxItem` (moved), `ComboboxListProps`, `ComboboxShell`, `ComboboxOption`
Consumes: `useDebouncedSearch` (`./search-input`), `Spinner`, `Skeleton`
Unchanged: `Combobox` and `ComboboxProps` keep their exact public shape, and `packages/ui/src/index.ts:98` needs no edit

- [ ] **Step 1: Write the characterisation test**

`packages/ui/test/combobox.dom.test.tsx`:

```tsx
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Combobox } from '../src/components/ui/combobox';

afterEach(cleanup);

const items = [
  { value: 'ext_1', label: 'SSC CGL' },
  { value: 'ext_2', label: 'RRB JE', hint: 'Junior Engineer' },
];

const box = (props: Partial<React.ComponentProps<typeof Combobox>> = {}) => (
  <Combobox value="" onChange={() => {}} items={items} placeholder="Choose…" {...props} />
);

describe('Combobox', () => {
  it('reads as its placeholder while nothing is chosen', () => {
    render(box());

    assert.ok(screen.getByRole('button', { name: 'Choose…' }));
  });

  it('names the chosen item on the trigger', () => {
    render(box({ value: 'ext_2' }));

    assert.ok(screen.getByRole('button', { name: 'RRB JE' }));
  });

  /** An option outside a listbox is invalid ARIA — a pile of buttons with no count or position. */
  it('opens a listbox of options', async () => {
    render(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.ok(await screen.findByRole('listbox'));
    // The two items plus the clear row.
    assert.equal(screen.getAllByRole('option').length, 3);
  });

  it('reports the chosen value and closes', async () => {
    const onChange = mock.fn();
    render(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['ext_1']);
    assert.equal(screen.queryByRole('listbox'), null);
  });

  it('offers no way back to nothing when it is not clearable', async () => {
    render(box({ clearable: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    await screen.findByRole('listbox');
    assert.equal(screen.getAllByRole('option').length, 2);
  });

  it('holds the shape of the rows that are coming rather than collapsing', async () => {
    render(box({ items: [], isLoading: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const list = await screen.findByRole('listbox');
    assert.equal(list.querySelectorAll('[data-slot="skeleton"]').length, 4);
    assert.equal(screen.queryByText('Nothing matches that'), null);
  });
});
```

- [ ] **Step 2: Run it and watch it pass — this is the net, not the goal**

```bash
pnpm --filter @iace/ui test 2>&1 | grep -A2 'Combobox'
```

Expected: `# pass 6`, `# fail 0`. A refactor with no test in front of it is a rewrite; this pins the behaviour before it moves. If the skeleton assertion fails, read the `data-slot` `Skeleton` actually renders (`packages/ui/src/components/ui/skeleton.tsx`) and correct the selector before going on.

- [ ] **Step 3: Extract the shell**

`packages/ui/src/components/ui/combobox-shell.tsx`:

```tsx
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebouncedSearch } from './search-input';
import { Spinner } from './spinner';
import { Skeleton } from './skeleton';

/** How close to the end counts as "nearly there", in pixels. */
const LOAD_MORE_THRESHOLD_PX = 160;

/** Stable no-op for the unsearchable case — a new arrow each render would make
 *  the hook look like it had a different consumer every time. */
const NO_SEARCH = () => {};

export interface ComboboxItem {
  value: string;
  label: string;
  /** A second line — a branch, a code, whatever tells two similar rows apart. */
  hint?: string;
}

/** Everything a combobox takes that is about the LIST rather than the selection. */
export interface ComboboxListProps {
  items: readonly ComboboxItem[];

  /** Shown when nothing is selected. */
  placeholder?: string;

  /** What `Field`'s render prop hands every control, so it can be spread. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;

  /** Server-side search. Leave both out for a plain, unsearchable list. */
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;

  /** Paging. `onLoadMore` fires when the bottom of the list comes into view. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;

  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export interface ComboboxShellProps extends ComboboxListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  triggerMuted: boolean;
  /** Announces the list as multi-select, and is what a screen reader counts against. */
  multiple?: boolean;
  children: React.ReactNode;
}

/** The popover, the trigger, the debounced search box and the scrolling list — shared by both. */
export function ComboboxShell({
  open,
  onOpenChange,
  triggerLabel,
  triggerMuted,
  multiple = false,
  children,
  items,
  placeholder = 'Choose…',
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  hasMore = false,
  onLoadMore,
  isLoading = false,
  isLoadingMore = false,
  emptyLabel = 'Nothing matches that',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  className,
}: Readonly<ComboboxShellProps>) {
  // Hooks cannot be conditional; unused, it never starts a timer.
  const { draft: searchDraft, type: typeSearch } = useDebouncedSearch(
    search ?? '',
    onSearchChange ?? NO_SEARCH,
  );

  /**
   * Fetch the next page near the bottom. A scroll handler, not an
   * IntersectionObserver: the list mounts in a portal and re-renders per page.
   */
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!onLoadMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX) onLoadMore();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          // Same height as Select: the two sit side by side in a filter row.
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm shadow-sm',
            'transition-[box-shadow,border-color] hover:border-ring',
            'focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', triggerMuted && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Matches the trigger width.
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {onSearchChange ? (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {/* Debounced for the same reason as SearchInput: this searches
                  the SERVER, so an unwaited keystroke is a request, and the
                  answers to the first seven letters of a group name are ones
                  nobody reads. The field itself stays instant. */}
              <input
                autoFocus
                value={searchDraft}
                onChange={(event) => typeSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}

          {/*
            role="listbox" is not decoration: the rows below carry
            role="option", and an option outside a listbox is invalid ARIA — a
            screen reader announces a pile of buttons rather than a list with a
            position and a count.
          */}
          <div
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-label={ariaLabel ?? placeholder}
            className="max-h-64 overflow-y-auto p-1"
            onScroll={onScroll}
          >
            {children}

            {/* Rows in the shape of the rows that are coming, so the list does
                not collapse to one line and then jump when they land. */}
            {isLoading ? <OptionSkeleton /> : null}
            {!isLoading && items.length === 0 ? <Status>{emptyLabel}</Status> : null}

            {/* Only while there is another page, so a finished list says so by
                showing nothing rather than a spinner that never resolves. */}
            {hasMore ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Spinner />
                <span className="text-xs text-muted-foreground">
                  {isLoadingMore ? 'Loading more…' : 'Scroll for more'}
                </span>
              </div>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function ComboboxOption({
  label,
  hint,
  selected,
  muted,
  onSelect,
}: Readonly<{
  label: string;
  hint?: string;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
}>) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
        muted && 'text-muted-foreground',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
    </button>
  );
}

function Status({ children }: Readonly<{ children: React.ReactNode }>) {
  return <p className="px-2 py-3 text-sm text-muted-foreground">{children}</p>;
}

/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = ['a', 'b', 'c', 'd'];

function OptionSkeleton() {
  return (
    <>
      {PLACEHOLDER_KEYS.map((key) => (
        <div key={key} className="px-2 py-2">
          <Skeleton variant="text" />
        </div>
      ))}
    </>
  );
}
```

`packages/ui/src/components/ui/combobox.tsx` becomes, in full:

```tsx
import * as React from 'react';
import { ComboboxOption, ComboboxShell, type ComboboxListProps } from './combobox-shell';

export type { ComboboxItem } from './combobox-shell';

export interface ComboboxProps extends ComboboxListProps {
  value: string;
  onChange: (value: string) => void;

  /** Label for the current value when it sits outside the loaded pages. */
  selectedLabel?: string;

  /** Omit to make the control mandatory — no way back to "no choice". */
  clearable?: boolean;
}

/**
 * Select for a list too long to render at once; the next page loads near the bottom.
 * Paging itself lives in `useInfinitePages` (@iace/app-kit).
 */
export function Combobox({
  value,
  onChange,
  selectedLabel,
  clearable = true,
  ...list
}: Readonly<ComboboxProps>) {
  const [open, setOpen] = React.useState(false);
  const placeholder = list.placeholder ?? 'Choose…';

  const selected = list.items.find((item) => item.value === value);

  return (
    <ComboboxShell
      {...list}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={selected?.label ?? selectedLabel ?? value ?? placeholder}
      triggerMuted={!selected && !selectedLabel}
    >
      {clearable ? (
        <ComboboxOption
          label={placeholder}
          muted
          selected={value === ''}
          onSelect={() => {
            onChange('');
            setOpen(false);
          }}
        />
      ) : null}

      {list.items.map((item) => (
        <ComboboxOption
          key={item.value}
          label={item.label}
          hint={item.hint}
          selected={item.value === value}
          onSelect={() => {
            onChange(item.value);
            setOpen(false);
          }}
        />
      ))}
    </ComboboxShell>
  );
}
```

- [ ] **Step 4: Run the tests, and the two apps that consume it**

```bash
pnpm --filter @iace/ui test 2>&1 | tail -8
pnpm --filter @iace/admin typecheck && pnpm --filter @iace/test typecheck
```

Expected: the same `# pass 6` for `Combobox` and `# fail 0` overall; both SPAs typecheck, proving `ComboboxProps` did not change shape.

---

### Task 9: `MultiCombobox`

**Files:**
Create: `packages/ui/src/components/ui/multi-combobox.tsx`, `packages/ui/test/multi-combobox.dom.test.tsx`
Modify: `packages/ui/src/index.ts:98` (beside `Combobox`), `packages/ui/test/shared-components.test.ts:21`

**Interfaces:**
Consumes: `ComboboxShell`, `ComboboxOption`, `ComboboxListProps` (`./combobox-shell`), `Badge`
Produces: `MultiCombobox`, `MultiComboboxProps { value: readonly string[]; onChange: (next: string[]) => void; selectedLabels?: Readonly<Record<string, string>> }` — `ComboboxProps` minus `clearable`

- [ ] **Step 1: Write the failing test**

`packages/ui/test/multi-combobox.dom.test.tsx`:

```tsx
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiCombobox } from '../src/components/ui/multi-combobox';

afterEach(cleanup);

const items = [
  { value: 'SSC CGL', label: 'SSC CGL' },
  { value: 'RRB JE', label: 'RRB JE', hint: 'Junior Engineer' },
  { value: 'SSC CHSL', label: 'SSC CHSL' },
];

const box = (props: Partial<React.ComponentProps<typeof MultiCombobox>> = {}) => (
  <MultiCombobox
    value={[]}
    onChange={() => {}}
    items={items}
    placeholder="Choose exams…"
    {...props}
  />
);

describe('MultiCombobox', () => {
  it('reads as its placeholder while nothing is chosen', () => {
    render(box());

    assert.ok(screen.getByRole('button', { name: 'Choose exams…' }));
  });

  it('summarises the selection on the trigger and lists it as chips', () => {
    render(box({ value: ['SSC CGL', 'RRB JE'] }));

    assert.ok(screen.getByRole('button', { name: '2 selected' }));
    assert.ok(screen.getByText('SSC CGL'));
    assert.ok(screen.getByRole('button', { name: 'Remove RRB JE' }));
  });

  /** A value chosen on an earlier page is still a chip, not a raw id. */
  it('names a value that sits outside the loaded pages', () => {
    render(box({ value: ['RRB NTPC'], items: [], selectedLabels: { 'RRB NTPC': 'RRB NTPC' } }));

    assert.ok(screen.getByRole('button', { name: 'Remove RRB NTPC' }));
  });

  it('announces the list as multi-select', async () => {
    render(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));

    const list = await screen.findByRole('listbox');
    assert.equal(list.getAttribute('aria-multiselectable'), 'true');
    assert.equal(screen.getAllByRole('option').length, 3);
  });

  /**
   * The failure this exists to prevent: closing on the first pick makes choosing three exam types
   * three round trips through the trigger, and the search term is lost every time.
   */
  it('adds a value and stays open for the next one', async () => {
    const onChange = mock.fn();
    render(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['SSC CGL']]);
    assert.ok(screen.getByRole('listbox'), 'the list must not close on a pick');
  });

  it('toggles a chosen value back off from the list', async () => {
    const onChange = mock.fn();
    render(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: '2 selected' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
  });

  it('removes a value from its chip, without opening the list', () => {
    const onChange = mock.fn();
    render(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove SSC CGL' }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
    assert.equal(screen.queryByRole('listbox'), null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/ui test 2>&1 | tail -20
```

Expected:

```
Error: Cannot find module '.../packages/ui/src/components/ui/multi-combobox'
```

- [ ] **Step 3: Implement**

`packages/ui/src/components/ui/multi-combobox.tsx`:

```tsx
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { ComboboxOption, ComboboxShell, type ComboboxListProps } from './combobox-shell';

export interface MultiComboboxProps extends ComboboxListProps {
  value: readonly string[];
  onChange: (next: string[]) => void;

  /** Labels for values sitting outside the loaded pages, keyed by value. */
  selectedLabels?: Readonly<Record<string, string>>;
}

/**
 * Combobox for a list too long to render at once, choosing more than one. The list stays open on a
 * pick; the selection sits under the control as chips, because a button cannot hold buttons.
 */
export function MultiCombobox({
  value,
  onChange,
  selectedLabels,
  ...list
}: Readonly<MultiComboboxProps>) {
  const [open, setOpen] = React.useState(false);
  const placeholder = list.placeholder ?? 'Choose…';

  const labelFor = (item: string) =>
    list.items.find((option) => option.value === item)?.label ?? selectedLabels?.[item] ?? item;

  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((chosen) => chosen !== item) : [...value, item]);

  const triggerLabel = () => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) return labelFor(value[0] as string);
    return `${value.length} selected`;
  };

  return (
    <div className="min-w-0">
      <ComboboxShell
        {...list}
        multiple
        open={open}
        onOpenChange={setOpen}
        triggerLabel={triggerLabel()}
        triggerMuted={value.length === 0}
      >
        {list.items.map((item) => (
          <ComboboxOption
            key={item.value}
            label={item.label}
            hint={item.hint}
            selected={value.includes(item.value)}
            onSelect={() => toggle(item.value)}
          />
        ))}
      </ComboboxShell>

      {value.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {value.map((item) => (
            <Badge key={item} variant="neutral" className="gap-1 pr-1">
              <span className="truncate">{labelFor(item)}</span>
              <button
                type="button"
                aria-label={`Remove ${labelFor(item)}`}
                onClick={() => onChange(value.filter((chosen) => chosen !== item))}
                className={cn(
                  'rounded-sm text-muted-foreground',
                  'hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none',
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/index.ts`, replacing line 98:

```ts
export { Combobox, type ComboboxItem, type ComboboxProps } from './components/ui/combobox';
export { MultiCombobox, type MultiComboboxProps } from './components/ui/multi-combobox';
```

`packages/ui/test/shared-components.test.ts:21` — the group and student forms both need it, which is the whole reason it lives here:

```ts
  for (const name of ['StatRow', 'StepIcon', 'PinField', 'MultiCombobox']) {
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @iace/ui test 2>&1 | tail -8 && pnpm --filter @iace/ui typecheck && pnpm --filter @iace/ui lint
```

Expected: `# fail 0` with 7 new `MultiCombobox` cases; no type or lint errors.

---

### Task 10: The Exam types screen

**Files:**
Create: `apps/admin/src/routes/exam-types.tsx`, `apps/admin/src/lib/use-exam-types.ts`
Modify: `apps/admin/src/lib/constants.ts:15` (`ROUTES`) and `:47` (`NAV_ITEMS`), `apps/admin/src/App.tsx:11` and `:41`, `packages/ui/test/confirm-destructive.test.ts:43-47`

**Interfaces:**
Consumes: `api.admin.examTypes.*`, `createExamTypeSchema`, `useAuth().identity.isSuperAdmin`, `PageHeader`/`TableFrame`/`DataTable`/`ConfirmDialog`/`Badge`/`plural` from `@iace/ui`
Produces: `ExamTypesPage`, `useExamTypes(options?: { activeOnly?: boolean }): ExamType[]`, `ROUTES.EXAM_TYPES = '/exam-types'`

- [ ] **Step 1: Write the failing test**

`packages/ui/test/confirm-destructive.test.ts`, extend the toggle map (lines 43–47):

```ts
const toggles = {
  'apps/admin/src/routes/admins.tsx': 'Reactivate',
  'apps/admin/src/routes/student-detail.tsx': 'Reactivate student',
  'apps/admin/src/routes/branches.tsx': 'Reactivate branch',
  'apps/admin/src/routes/exam-types.tsx': 'Reactivate exam type',
};
```

and add a case beside the branch one (after line 72):

```ts
/** Retiring an exam type is reversible AND asks — its effect lands weeks later, on somebody else. */
it('includes retiring an exam type', () => {
  const examTypes = readFileSync(
    path.join(REPO_ROOT, 'apps/admin/src/routes/exam-types.tsx'),
    'utf8',
  );
  assert.ok(
    examTypes.includes("'Retire exam type'"),
    'retiring an exam type must go through a ConfirmDialog',
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @iace/ui test 2>&1 | grep -A3 'destructive actions'
```

Expected:

```
not ok 2 - ask in both directions of a toggle
  error: "ENOENT: no such file or directory, open '.../apps/admin/src/routes/exam-types.tsx'"
```

- [ ] **Step 3: Implement**

`apps/admin/src/lib/use-exam-types.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type ExamType } from '@iace/contracts';
import { api } from './api';

/** The exam-type list, unpaged and long-cached: a small list that changes a few times a year. */
export function useExamTypes(options: { activeOnly?: boolean } = {}): ExamType[] {
  const { activeOnly } = options;

  const query = useQuery({
    queryKey: ['admin', 'exam-types', { activeOnly: activeOnly ?? false }],
    queryFn: () =>
      api.admin.examTypes.list({
        pageSize: PAGE_SIZE_MAX,
        ...(activeOnly ? { activeOnly: 'true' as const } : {}),
      }),
    staleTime: 5 * 60_000,
  });

  return query.data?.items ?? [];
}
```

`apps/admin/src/routes/exam-types.tsx`:

```tsx
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Power, Trash2 } from 'lucide-react';
import { createExamTypeSchema, type CreateExamTypeInput, type ExamType } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  PageHeader,
  plural,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { useExamTypes } from '../lib/use-exam-types';
import { applyFieldErrors } from '@iace/app-kit';

const NEW_EXAM_TYPE_FIELDS = ['name', 'code'] as const;

const EXAM_TYPES_QUERY_KEY = ['admin', 'exam-types'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function examTypeColumns(isSuperAdmin: boolean, refresh: () => void): DataTableColumn<ExamType>[] {
  return [
    { key: 'name', header: 'Exam type', className: 'font-medium', cell: (type) => type.name },
    {
      key: 'code',
      header: 'Code',
      cell: (type) => <span className="font-mono text-sm">{type.code}</span>,
    },
    {
      key: 'groups',
      header: 'Groups',
      numeric: true,
      cell: (type) =>
        type.groupCount > 0 ? type.groupCount : <span className="text-muted-foreground">0</span>,
    },
    { key: 'status', header: 'Status', cell: (type) => <ExamTypeStatus examType={type} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (type) => (
        <ExamTypeRowActions examType={type} canEdit={isSuperAdmin} onChanged={refresh} />
      ),
    },
  ];
}

/** Anyone managing groups may read the catalog, because they pick from it. Only a super admin writes. */
export function ExamTypesPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const examTypes = useExamTypes();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: EXAM_TYPES_QUERY_KEY }),
    [queryClient],
  );

  const columns = useMemo(() => examTypeColumns(isSuperAdmin, refresh), [isSuperAdmin, refresh]);

  const header = (
    <>
      <PageHeader
        title="Exam types"
        description="The exams the institute coaches for. Groups and student enrolments are both recorded against the code."
        action={
          isSuperAdmin ? (
            <Button size="sm" onClick={() => setCreating((open) => !open)}>
              <Plus aria-hidden />
              New exam type
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Alert variant="info" className="mb-5">
          <span>
            Only a super admin can add or change an exam type. You can see the list to pick from.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewExamTypeCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </>
  );

  return (
    <TableFrame framed={!creating} header={header}>
      {/* No pagination: `useExamTypes` already loads the whole short list. */}
      <DataTable
        columns={columns}
        rows={examTypes}
        rowKey={(type) => type.id}
        isLoading={false}
        empty="No exam types yet."
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewExamTypeCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateExamTypeInput>({
    resolver: zodResolver(createExamTypeSchema),
    defaultValues: { name: '', code: '' },
  });

  const create = useMutation({
    meta: { success: 'Exam type created.', fields: NEW_EXAM_TYPE_FIELDS },
    mutationFn: (values: CreateExamTypeInput) => api.admin.examTypes.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_EXAM_TYPE_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New exam type</CardTitle>
        <CardDescription>
          The name is what admins read; the code is what groups and enrolments store. Choose the
          code carefully — once any group uses it, it can no longer be changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="name" label="Name" className="min-w-56 flex-1">
            {(control) => (
              <Input {...control} placeholder="SSC Combined Graduate Level" autoFocus />
            )}
          </FormField>

          <FormField form={form} name="code" label="Code" className="min-w-40 flex-1">
            {(control) => (
              <Input
                {...control}
                className="uppercase placeholder:normal-case"
                placeholder="SSC CGL"
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** One question at a time: two booleans could render two dialogs at once. */
const EXAM_TYPE_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type ExamTypeConfirm = (typeof EXAM_TYPE_CONFIRMS)[keyof typeof EXAM_TYPE_CONFIRMS];

function ExamTypeStatus({ examType }: Readonly<{ examType: ExamType }>) {
  if (examType.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/**
 * The buttons only ask; both dialogs live with the mutations in `ExamTypeRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function ExamTypeActions({
  examType,
  canEdit,
  busy,
  onAsk,
}: Readonly<{
  examType: ExamType;
  canEdit: boolean;
  busy: boolean;
  onAsk: (confirm: ExamTypeConfirm) => void;
}>) {
  if (!canEdit) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(EXAM_TYPE_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {examType.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onAsk(EXAM_TYPE_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

function ExamTypeRowActions({
  examType,
  canEdit,
  onChanged,
}: Readonly<{ examType: ExamType; canEdit: boolean; onChanged: () => void }>) {
  const [asking, setAsking] = useState<ExamTypeConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${examType.name} deleted.` },
    mutationFn: () => api.admin.examTypes.remove(examType.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${examType.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.examTypes.update(examType.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <ExamTypeActions examType={examType} canEdit={canEdit} busy={busy} onAsk={setAsking} />

      <ConfirmDialog
        open={asking === EXAM_TYPE_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={examType.isActive ? `Retire ${examType.name}?` : `Reactivate ${examType.name}?`}
        description={
          examType.isActive
            ? `Nothing it already holds changes — ${plural(examType.groupCount, 'group')} and every student enrolled under ${examType.code} keep working exactly as now. What stops is new ones: this exam type will no longer be offered when anyone creates a group or enrols a student. Reactivating puts it back.`
            : 'The exam type is offered again on the group and student forms. Nothing else changes.'
        }
        confirmLabel={examType.isActive ? 'Retire exam type' : 'Reactivate exam type'}
        onConfirm={() => setActive.mutate(!examType.isActive)}
      />

      {/* Deleting is refused server-side while anything still points here, so the
          count decides which of two different questions this is. */}
      <ConfirmDialog
        open={asking === EXAM_TYPE_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${examType.name}?`}
        description={
          examType.groupCount === 0
            ? `Nothing points at ${examType.code} from the groups list. If a base config, a test or an enrolled student still does, this will be refused. Deleting cannot be undone.`
            : `${plural(examType.groupCount, 'group')} still use ${examType.code}, and deleting it will be refused. Retire the exam type instead — it keeps everything it has and is simply no longer offered.`
        }
        confirmLabel="Delete exam type"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
```

`apps/admin/src/lib/constants.ts` — after `BRANCHES` (line 15):

```ts
  EXAM_TYPES: '/exam-types',
```

the icon import on line 1 gains `GraduationCap`, and `NAV_ITEMS` gains a row after Branches (line 47):

```ts
      { to: ROUTES.EXAM_TYPES, label: 'Exam types', icon: GraduationCap },
```

`apps/admin/src/App.tsx` — `import { ExamTypesPage } from './routes/exam-types';` after line 11, and after line 41:

```tsx
<Route path={ROUTES.EXAM_TYPES} element={<ExamTypesPage />} />
```

- [ ] **Step 4: Add the rename, and say when the code is frozen**

Branches has no edit affordance to mirror, and exam types need one: a typo in a code must be fixable
before any group carries it, and after that the server refuses (Task 6). Put it in `ExamTypeRowActions`,
beside Retire and Delete — an `Edit` button opening a `ConfirmDialog`-sized card with the two fields:

```tsx
function EditExamTypeCard({
  examType,
  onDone,
  onCancel,
}: Readonly<{ examType: ExamType; onDone: () => void; onCancel: () => void }>) {
  const form = useForm<UpdateExamTypeInput>({
    resolver: zodResolver(updateExamTypeSchema),
    defaultValues: { name: examType.name, code: examType.code },
  });

  const save = useMutation({
    meta: { success: 'Exam type saved.', fields: EDIT_EXAM_TYPE_FIELDS },
    mutationFn: (values: UpdateExamTypeInput) => api.admin.examTypes.update(examType.id, values),
    onError: (error) => applyFieldErrors(form, error, EDIT_EXAM_TYPE_FIELDS),
    onSuccess: onDone,
  });

  const codeIsFrozen = examType.groupCount > 0;

  return (
    <Card>
      <CardContent>
        <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <FormRow>
            <FormField form={form} name="name" label="Name">
              {(control) => <Input {...control} />}
            </FormField>

            <FormField
              form={form}
              name="code"
              label="Code"
              hint={
                codeIsFrozen
                  ? `${plural(examType.groupCount, 'group')} already carry this code — it can no longer change.`
                  : 'Stored on every group and every enrolment, so it is fixed once one exists.'
              }
            >
              {(control) => (
                <Input
                  {...control}
                  disabled={codeIsFrozen}
                  className="uppercase placeholder:normal-case"
                />
              )}
            </FormField>
          </FormRow>

          <FormActions>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
```

with `const EDIT_EXAM_TYPE_FIELDS = ['name', 'code'] as const;` beside `NEW_EXAM_TYPE_FIELDS`. The hint is
belt and braces: `examTypeEditBlocker` refuses the change server-side whatever the input is disabled or not.

- [ ] **Step 5: Run the tests and the screen**

```bash
pnpm --filter @iace/ui test 2>&1 | tail -8
pnpm --filter @iace/admin typecheck && pnpm --filter @iace/admin lint && pnpm --filter @iace/admin build
```

Expected: `# fail 0`; the admin SPA typechecks, lints and builds. Then, with the API running, open `/exam-types` as a super admin, create `SSC CGL`, retire it, reactivate it, delete it — each write asks first, and the delete of a type with groups comes back with the blocker's sentence.

---

### Task 11: Green the gates and commit

**Files:** none new — this is the commit for Tasks 1–10.

**Interfaces:** Consumes: `scripts/sonar-precommit.sh` via the `pre-commit` hook. Produces: one commit on `main`.

- [ ] **Step 1: Format, then run every gate**

```bash
node --version   # must print v22.x — pnpm 11 dies on Node 20
pnpm format
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all five green. `pnpm test` must show `# fail 0` for `@iace/api`, `@iace/contracts` and `@iace/ui`.

- [ ] **Step 2: Reload the touched files and run SonarQube**

Reload every file this commit touched, then analyse via the SonarQube MCP tools with project key `iace-platform`. Fix the cause of every BLOCKER/CRITICAL/MAJOR finding and re-analyse until clean. Pay particular attention to `exam-types.tsx` (cognitive complexity, `typescript:S3776`) and to duplication between `combobox.tsx` and `multi-combobox.tsx` (`common-ts:DuplicatedBlocks`) — Task 8 exists to keep that at zero, so a finding there means the shell was not actually shared.

- [ ] **Step 3: Move the untracked file the gate trips on**

`packages/contracts/src/questions.ts` is untracked, is not part of this commit, and trips the gate on `typescript:S3776`. The scanner reads the working tree, not the index, so it has to leave the tree for the length of the commit — done twice already this session.

```bash
cp packages/contracts/src/questions.ts /private/tmp/claude-501/-Users-harshithdiyyala-Projects-iace/3ea8439c-2bf9-4f47-a619-c4a97c1246a3/scratchpad/questions.ts.keep
shasum -a 256 packages/contracts/src/questions.ts
rm packages/contracts/src/questions.ts
```

Record the sha — Step 5 checks the restored file against it.

- [ ] **Step 4: Stage whole files and commit**

```bash
git status --short
git add prisma/schema.prisma prisma/migrations/20260818110000_exam_type_codes_and_state \
  packages/contracts/src/exam-types.ts packages/contracts/src/index.ts packages/contracts/src/client.ts \
  packages/contracts/test/exam-types.test.ts \
  packages/ui/src/components/ui/combobox.tsx packages/ui/src/components/ui/combobox-shell.tsx \
  packages/ui/src/components/ui/multi-combobox.tsx packages/ui/src/index.ts \
  packages/ui/test/combobox.dom.test.tsx packages/ui/test/multi-combobox.dom.test.tsx \
  packages/ui/test/shared-components.test.ts packages/ui/test/confirm-destructive.test.ts \
  apps/api/src/configs apps/api/src/app.module.ts \
  apps/api/src/groups/groups.service.ts apps/api/src/students/students.service.ts \
  apps/api/test/support/fakes.ts apps/api/test/module-facades.unit.test.ts \
  apps/api/test/exam-type-rules.unit.test.ts apps/api/test/exam-types-service.unit.test.ts \
  apps/admin/src/routes/exam-types.tsx apps/admin/src/lib/use-exam-types.ts \
  apps/admin/src/lib/constants.ts apps/admin/src/App.tsx
git diff --stat   # must be empty — a partly staged file makes lint-staged stash the rest
```

Then commit. No `--no-verify`, no `SKIP_SONAR=1`, no `Co-Authored-By`:

```bash
git commit -F - <<'MSG'
feat(configs): add the exam-type catalog nothing could write

`ExamType` has existed since the init migration and no code has ever written a
row to it. `Group.examType` and `Student.enrolledExams` therefore had no catalog
to validate against, every enrolment was empty, and access resolved to nothing
for everyone.

This adds the `configs` module docs/03 §5 assigns `ExamType` to, end to end: the
canonical `code` that groups and enrolments store by, `isActive` so a type can
be retired instead of deleted, and the two blockers that keep the catalog
trustworthy. The edit blocker is the load-bearing one — `Group.examType` and
`Student.enrolledExams` hold the code as free text with no foreign key, so a
rename would detach every group and every enrolment with no error, no rows
changed and nothing to notice. The deletion blocker counts all four holders
because `BaseConfig.examTypeId` CASCADEs and takes its sections with it, and a
test reachable only through a config is invisible to a count on
`Test.examTypeId` alone.

The counts cross module boundaries, so they arrive through facades —
`GroupsService.countByExamType` and `StudentsService.countEnrolledIn` — rather
than `configs` reading two tables it does not own. `assertUsable` takes the
field key as a parameter rather than hardcoding it the way branches does:
`applyFieldErrors` silently drops a key the receiving form does not own, and the
group form's field is `examType` while the student form's is `enrolledExams`.

Migration A backfills `code` from the canonicalised name, refuses to continue if
any row cannot be canonicalised or two rows collide, and only then makes the
column NOT NULL. A silent backfill would write values the update schema rejects
on every later PATCH, producing rows that could never be edited again.

`MultiCombobox` lands here rather than with its first consumer: the group form
and the student form both need it, and packages/ui/test/shared-components.test.ts
holds the rule that a component two screens need lives in the design system. The
popover, trigger and paged list move into a shared `ComboboxShell` so the second
variant is a variant rather than a copy.
MSG
```

- [ ] **Step 5: Put the untracked file back, byte for byte**

```bash
cp /private/tmp/claude-501/-Users-harshithdiyyala-Projects-iace/3ea8439c-2bf9-4f47-a619-c4a97c1246a3/scratchpad/questions.ts.keep packages/contracts/src/questions.ts
shasum -a 256 packages/contracts/src/questions.ts   # must match Step 3
git status --short                                   # must be exactly: ?? packages/contracts/src/questions.ts
git log --oneline -1
```

Expected: the sha matches, the working tree holds only the untracked file it held before, and the commit is on `main`. Never `git push`.

---

### Task 20: Migration B — `Group.isActive` and the two seeded singletons

**Files:**
Create: `prisma/migrations/20260818120000_group_state_and_singletons/migration.sql`, `apps/api/test/migration-seeds.unit.test.ts`
Modify: `prisma/schema.prisma` (the `model Group` block), `README.md` (beside the super-admin bootstrap)
Test: `apps/api/test/migration-seeds.unit.test.ts`

**Interfaces:**
Consumes: `GROUP_TYPE`, `BRANCH_TYPE` from `@iace/contracts`.
Produces: column `Group.isActive Boolean NOT NULL DEFAULT true`; row `Group{id:'grpglobal00000000000000', type:'GLOBAL'}`; row `Branch{id:'brnchonline000000000000', type:'VIRTUAL'}`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/migration-seeds.unit.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BRANCH_TYPE, GROUP_TYPE } from '@iace/contracts';

/**
 * Nothing in the application creates either singleton, and the rules that protect them
 * (`groupEditBlocker`, `branchEditBlocker`) assume exactly one of each is there.
 */
const PRISMA_DIR = join(__dirname, '../../../prisma');
const SCHEMA = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
const MIGRATION = readFileSync(
  join(PRISMA_DIR, 'migrations/20260818120000_group_state_and_singletons/migration.sql'),
  'utf8',
);

describe('Group.isActive', () => {
  it('is declared on the model with a default, so every existing group stays active', () => {
    const model = /model Group \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? '';
    assert.match(model, /isActive\s+Boolean\s+@default\(true\)/);
  });

  it('is added by the migration, so the schema and the database agree', () => {
    assert.match(
      MIGRATION,
      /ALTER TABLE "Group" ADD COLUMN\s+"isActive" BOOLEAN NOT NULL DEFAULT true/,
    );
  });
});

describe('the seeded singletons', () => {
  it('seeds the all-students group and the online branch', () => {
    assert.match(MIGRATION, new RegExp(`INSERT INTO "Group"[\\s\\S]*'${GROUP_TYPE.GLOBAL}'`));
    assert.match(MIGRATION, new RegExp(`INSERT INTO "Branch"[\\s\\S]*'${BRANCH_TYPE.VIRTUAL}'`));
  });

  /** The failure this prevents: a re-run, or a database that already holds one, ending with two. */
  it('guards both inserts on the type, not on the id', () => {
    const guards = MIGRATION.match(
      /WHERE NOT EXISTS \(SELECT 1 FROM "(Group|Branch)" WHERE "type"/g,
    );
    assert.equal(guards?.length, 2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/migration-seeds.unit.test.ts
```

Expected: the suite aborts before the first test with `ENOENT: no such file or directory, open '.../prisma/migrations/20260818120000_group_state_and_singletons/migration.sql'`.

- [ ] **Step 3: Implement**

```sql
-- prisma/migrations/20260818120000_group_state_and_singletons/migration.sql
-- Group state, and the two rows the access model assumes exist.
--
-- Both seeds are guarded on the TYPE rather than the id: what must be unique is
-- "one all-students group" and "one branch with no address", not a literal id.

ALTER TABLE "Group" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "Group" ("id","name","type","isActive","createdAt","updatedAt")
SELECT 'grpglobal00000000000000', 'ALL STUDENTS', 'GLOBAL', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Group" WHERE "type" = 'GLOBAL');

INSERT INTO "Branch" ("id","name","type","isActive","createdAt","updatedAt")
SELECT 'brnchonline000000000000', 'ONLINE', 'VIRTUAL', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Branch" WHERE "type" = 'VIRTUAL');
```

In `prisma/schema.prisma`, inside `model Group`, after the `examType` line:

```prisma
  /// Retired: keeps its history and its members, takes no new ones.
  isActive    Boolean   @default(true)
```

In `README.md`, beside the super-admin bootstrap note:

```md
The all-students group (`GLOBAL`) and the online branch (`VIRTUAL`) are created by
`20260818120000_group_state_and_singletons`. There is still no seed script: run the migrations and
both rows are there.
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/migration-seeds.unit.test.ts test/prisma-enums.unit.test.ts
```

---

### Task 21: Contracts — `branchIds`, `type`, and the shape rules a type imposes

**Files:**
Modify: `packages/contracts/src/groups.ts` (header comment, after `deactivatedMemberBlocker`, `groupSummarySchema:46`, `groupListQuerySchema:61`, `createGroupSchema:74`, `updateGroupSchema:83`)
Test: `apps/api/test/groups.unit.test.ts` (the `group contracts` describe, `:125-201`)

**Interfaces:**
Consumes: `examTypeCodeSchema` from `./exam-types` (Task 1's file), `groupNameSchema`, `branchRefSchema`.
Produces: `GROUP_TYPES_ACCEPTING_GRANTS`, `GROUP_TYPES_REQUIRING_EXAM`, `CREATABLE_GROUP_TYPES`, `acceptsDirectGrants(type: GroupType): boolean`, `requiresExamType(type: GroupType): boolean`, `GROUP_REACH`, `groupReach(group: { type: GroupType; examType: string | null }): GroupReach`, `groupShapeIssue(input: { type: GroupType; examType?: string | null; branchIds?: readonly string[] }): GroupShapeIssue | null`, `DIRECT_GRANT_MESSAGE`, `EXAM_TYPE_REQUIRED_MESSAGE`, `EXAM_TYPE_NOT_ALLOWED_MESSAGE`, `BRANCH_REQUIRED_MESSAGE`, `GLOBAL_GROUP_UNCREATABLE_MESSAGE`; `createGroupSchema` `{ name, type, examType?, branchIds, description? }`; `updateGroupSchema` `{ name?, examType?, branchIds?, description?, isActive? }`; `groupSummarySchema.isActive`; `groupListQuerySchema.acceptsGrants` (the filter the student-detail picker needs in commit 3 — a group that is reached by enrolment must never be offered as a grant).

Add to `groupListQuerySchema`, beside `branchId`:

```ts
  /** Only the types a student can be granted one of, one student at a time. */
  acceptsGrants: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
```

- [ ] **Step 1: Write the failing test** — replace the whole `describe('group contracts', …)` block at `apps/api/test/groups.unit.test.ts:125-201`, and extend the import at `:3-12` with `GROUP_REACH`, `groupReach`, `groupShapeIssue`, `acceptsDirectGrants`, `requiresExamType`.

```ts
describe('group contracts', () => {
  const exam = {
    name: 'SSC Morning',
    type: GROUP_TYPE.EXAM,
    examType: 'ssc cgl',
    branchIds: ['b1'],
  };

  it('requires a usable group name', () => {
    assert.equal(createGroupSchema.safeParse(exam).success, true);
    assert.equal(createGroupSchema.safeParse({ ...exam, name: 'A' }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, name: '   ' }).success, false);
  });

  /** An EXAM group is reached by an enrolment matching its code, so a null one reaches nobody. */
  it('requires an exam and a branch for the types that are reached by one', () => {
    assert.equal(createGroupSchema.safeParse({ ...exam, examType: undefined }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, branchIds: [] }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, type: GROUP_TYPE.PROGRAM }).success, true);
  });

  /** A scholarship group is granted student by student, so an exam code on it would be a lie. */
  it('forbids an exam on the types that are granted one at a time, and asks for no branch', () => {
    const grant = { name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP };
    assert.equal(createGroupSchema.safeParse(grant).success, true);
    assert.equal(createGroupSchema.safeParse({ ...grant, examType: 'SSC CGL' }).success, false);
  });

  it('refuses to create a second all-students group', () => {
    const parsed = createGroupSchema.safeParse({ name: 'EVERYONE', type: GROUP_TYPE.GLOBAL });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], 'type');
  });

  it('canonicalises the name and the exam code, so "SSC " and "ssc" cannot both exist', () => {
    const parsed = createGroupSchema.parse({ ...exam, name: '  SSC Morning  ' });
    assert.equal(parsed.name, 'SSC MORNING');
    assert.equal(parsed.examType, 'SSC CGL');
  });

  /** Retyping a group silently changes who reaches it, and GLOBAL could be retyped into existence. */
  it('refuses to retype a group on update', () => {
    assert.equal('type' in updateGroupSchema.parse({ type: GROUP_TYPE.PROGRAM } as never), false);
  });

  it('lets a group be moved between branches and retired on update', () => {
    assert.deepEqual(updateGroupSchema.parse({ branchIds: ['b1', 'b2'] }).branchIds, ['b1', 'b2']);
    assert.equal(updateGroupSchema.parse({ isActive: false }).isActive, false);
  });

  it('treats update as a patch — an empty body is valid and changes nothing', () => {
    assert.equal(updateGroupSchema.safeParse({}).success, true);
  });

  it('refuses an empty add — an admin meant to pick someone', () => {
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: [] }).success, false);
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: ['stu_1'] }).success, true);
  });

  it('refuses an oversized page rather than quietly clamping it', () => {
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '101' }).success, false);
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '0' }).success, false);
    assert.equal(groupListQuerySchema.parse({ pageSize: '100' }).pageSize, 100);
  });

  it('defaults to page 1 of 20 when nothing is asked for', () => {
    assert.equal(groupListQuerySchema.parse({}).page, 1);
    assert.equal(groupListQuerySchema.parse({}).pageSize, 20);
  });

  it('carries the counts and the state a group list is opened to see', () => {
    const summary = {
      id: 'g1',
      name: 'SSC MORNING',
      type: GROUP_TYPE.EXAM,
      examType: 'SSC CGL',
      isActive: true,
      branches: [{ id: 'b1', name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL }],
      description: null,
      studentCount: 42,
      testSeriesCount: 2,
      createdAt: new Date().toISOString(),
    };
    assert.equal(groupSummarySchema.safeParse(summary).success, true);

    const { isActive: _a, ...withoutState } = summary;
    assert.equal(groupSummarySchema.safeParse(withoutState).success, false);
  });
});

describe('groupReach — one answer for the count, the roster filter and the resolver', () => {
  it('reaches everybody through the all-students group', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.GLOBAL, examType: null }), GROUP_REACH.EVERYONE);
  });

  it('reaches an exam group through the enrolment that names it', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }), GROUP_REACH.ENROLMENT);
    assert.equal(
      groupReach({ type: GROUP_TYPE.PROGRAM, examType: 'SSC CGL' }),
      GROUP_REACH.ENROLMENT,
    );
  });

  /**
   * The failure this prevents: an EXAM group with no code silently counting the whole roster
   * or nobody. With no code there is nothing to match, so only an explicit grant reaches it.
   */
  it('falls back to explicit grants for an exam group carrying no code', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.EXAM, examType: null }), GROUP_REACH.GRANT);
    assert.equal(groupReach({ type: GROUP_TYPE.SCHOLARSHIP, examType: null }), GROUP_REACH.GRANT);
  });
});

describe('groupShapeIssue — the same rule the form and the API run', () => {
  it('passes a shape that is already right', () => {
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL', branchIds: ['b1'] }),
      null,
    );
  });

  it('names the field an admin has to fix', () => {
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: null, branchIds: ['b1'] })?.path,
      'examType',
    );
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL', branchIds: [] })?.path,
      'branchIds',
    );
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.NON_IACE, examType: 'SSC CGL' })?.path,
      'examType',
    );
  });

  /** A PATCH sets some fields. An absent one is not being changed, so it cannot be wrong. */
  it('skips a field the patch does not carry', () => {
    assert.equal(groupShapeIssue({ type: GROUP_TYPE.EXAM }), null);
  });
});

describe('which groups take a student one at a time', () => {
  it('accepts a grant only for scholarship and non-IACE', () => {
    assert.deepEqual(Object.values(GROUP_TYPE).filter(acceptsDirectGrants), [
      GROUP_TYPE.SCHOLARSHIP,
      GROUP_TYPE.NON_IACE,
    ]);
  });

  it('asks for an exam code only where an enrolment reaches it', () => {
    assert.deepEqual(Object.values(GROUP_TYPE).filter(requiresExamType), [
      GROUP_TYPE.EXAM,
      GROUP_TYPE.PROGRAM,
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups.unit.test.ts
```

Expected: `SyntaxError: The requested module '@iace/contracts' does not provide an export named 'GROUP_REACH'`.

- [ ] **Step 3: Implement** — in `packages/contracts/src/groups.ts`: add `import { examTypeCodeSchema } from './exam-types';` beside the other imports, replace the header comment block (`:6-11`), append the block below after `deactivatedMemberBlocker`, add `isActive: z.boolean(),` to `groupSummarySchema` after `examType`, and replace `createGroupSchema`/`updateGroupSchema`.

```ts
// ============================================================================
// Groups — the access unit: Student -> Group -> TestSeries -> Test. How a group
// finds its students is decided by its TYPE: an enrolment matching its exam
// code, the whole roster, or a grant made student by student. Name unique
// within the exam code.
// ============================================================================
```

```ts
/** The two types a student is put into one at a time. Every other type is reached by who they are. */
export const GROUP_TYPES_ACCEPTING_GRANTS = [GROUP_TYPE.SCHOLARSHIP, GROUP_TYPE.NON_IACE] as const;

/** EXAM and PROGRAM are reached by an enrolment, so both carry the code that enrolment matches. */
export const GROUP_TYPES_REQUIRING_EXAM = [GROUP_TYPE.EXAM, GROUP_TYPE.PROGRAM] as const;

/** GLOBAL is seeded by a migration and is never created again. */
export const CREATABLE_GROUP_TYPES = [
  GROUP_TYPE.EXAM,
  GROUP_TYPE.PROGRAM,
  GROUP_TYPE.SCHOLARSHIP,
  GROUP_TYPE.NON_IACE,
] as const;

export function acceptsDirectGrants(type: GroupType): boolean {
  return (GROUP_TYPES_ACCEPTING_GRANTS as readonly GroupType[]).includes(type);
}

export function requiresExamType(type: GroupType): boolean {
  return (GROUP_TYPES_REQUIRING_EXAM as readonly GroupType[]).includes(type);
}

export const DIRECT_GRANT_MESSAGE =
  'Students reach this group through their enrolment, so they cannot be added to it one at a time.';

export const EXAM_TYPE_REQUIRED_MESSAGE = 'Pick the exam this group is for';
export const EXAM_TYPE_NOT_ALLOWED_MESSAGE =
  'This group is granted student by student, so it is not tied to an exam';
export const BRANCH_REQUIRED_MESSAGE = 'Pick at least one branch';
export const GLOBAL_GROUP_UNCREATABLE_MESSAGE =
  'The all-students group already exists — it is never created again';

/** How a group finds its students. The count, the roster filter and the resolver must agree. */
export const GROUP_REACH = {
  ENROLMENT: 'ENROLMENT',
  EVERYONE: 'EVERYONE',
  GRANT: 'GRANT',
} as const;
export type GroupReach = (typeof GROUP_REACH)[keyof typeof GROUP_REACH];

export function groupReach(group: { type: GroupType; examType: string | null }): GroupReach {
  if (group.type === GROUP_TYPE.GLOBAL) return GROUP_REACH.EVERYONE;
  if (requiresExamType(group.type) && group.examType) return GROUP_REACH.ENROLMENT;
  return GROUP_REACH.GRANT;
}

export interface GroupShapeIssue {
  path: 'examType' | 'branchIds';
  message: string;
}

/** What a type demands of the rest of the body. `undefined` is "not being set", so a patch skips it. */
export function groupShapeIssue(input: {
  type: GroupType;
  examType?: string | null;
  branchIds?: readonly string[];
}): GroupShapeIssue | null {
  if (requiresExamType(input.type)) {
    if (input.examType !== undefined && !input.examType)
      return { path: 'examType', message: EXAM_TYPE_REQUIRED_MESSAGE };
    if (input.branchIds !== undefined && input.branchIds.length === 0)
      return { path: 'branchIds', message: BRANCH_REQUIRED_MESSAGE };
    return null;
  }
  if (input.examType) return { path: 'examType', message: EXAM_TYPE_NOT_ALLOWED_MESSAGE };
  return null;
}
```

```ts
export const createGroupSchema = z
  .object({
    name: groupNameSchema,
    type: groupTypeSchema,
    examType: examTypeCodeSchema.optional(),
    branchIds: z.array(z.string().min(1)).default([]),
    description: z.string().trim().max(500).nullish(),
  })
  .superRefine((input, ctx) => {
    if (!(CREATABLE_GROUP_TYPES as readonly GroupType[]).includes(input.type)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: GLOBAL_GROUP_UNCREATABLE_MESSAGE });
      return;
    }
    const issue = groupShapeIssue({
      type: input.type,
      examType: input.examType ?? null,
      branchIds: input.branchIds,
    });
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type CreateGroupBody = z.infer<typeof createGroupSchema>;

/** `type` is absent on purpose: retyping a group silently changes who reaches it. */
export const updateGroupSchema = z.object({
  name: groupNameSchema.optional(),
  examType: examTypeCodeSchema.optional(),
  branchIds: z.array(z.string().min(1)).optional(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;
export type UpdateGroupBody = z.infer<typeof updateGroupSchema>;
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups.unit.test.ts
```

Expected: the `group contracts`, `groupReach`, `groupShapeIssue` and grant-type describes pass; `canRemoveFromGroup` and `groupDeletionBlocker` still fail to typecheck at runtime only if Task 22 has run — leave them as they are for now.

---

### Task 22: Delete the last-group rule, and protect the GLOBAL singleton instead

**Files:**
Modify: `apps/api/src/groups/group-rules.ts` (whole file), `apps/api/src/groups/groups.service.ts:180-201` (`removeMember`) and its import at `:19`, `apps/api/src/students/students.service.ts:185-196`, `apps/admin/src/routes/student-detail.tsx:108-112`
Test: `apps/api/test/groups.unit.test.ts` (`:24-52` and `:80-123`)

**Interfaces:**
Produces: `groupDeletionBlocker(usage: { type: GroupType; studentCount: number; testSeriesCount: number }): string | null`, `groupEditBlocker(group: { type: GroupType }, changes: { name?: string; isActive?: boolean }): string | null`.
Removes: `canRemoveFromGroup`, `LAST_GROUP_MESSAGE`.

- [ ] **Step 1: Write the failing test** — in `apps/api/test/groups.unit.test.ts`, replace the import at `:13-17` with `import { groupDeletionBlocker, groupEditBlocker } from '../src/groups/group-rules';`, replace the `groupDeletionBlocker` describe (`:24-52`), and delete both the `canRemoveFromGroup` describe (`:80-100`) and the `emptying a student's batches` describe (`:102-123`), putting this in their place.

```ts
describe('groupDeletionBlocker', () => {
  const empty = { type: GROUP_TYPE.SCHOLARSHIP, studentCount: 0, testSeriesCount: 0 };

  it('allows deleting a group nothing depends on', () => {
    assert.equal(groupDeletionBlocker(empty), null);
  });

  /**
   * The failure this prevents: the count is type-aware now, so an EXAM group thousands of students
   * reach no longer reports 0 and no longer passes this.
   */
  it('refuses while students are still in it, and says how many', () => {
    const blocker = groupDeletionBlocker({ ...empty, type: GROUP_TYPE.EXAM, studentCount: 12 });

    assert.ok(blocker);
    assert.match(blocker, /12 students/);
  });

  it('gets the singular right, because an admin reads this message', () => {
    assert.match(groupDeletionBlocker({ ...empty, studentCount: 1 })!, /1 student\./);
  });

  it('refuses while a test series is still linked, even with no students', () => {
    assert.match(groupDeletionBlocker({ ...empty, testSeriesCount: 2 })!, /test series/);
  });

  it('reports the students first — it is the one the admin must act on', () => {
    assert.match(
      groupDeletionBlocker({ ...empty, studentCount: 3, testSeriesCount: 3 })!,
      /students/,
    );
  });

  /** Seeded by a migration, reached by everybody, and re-created by nothing. */
  it('never deletes the all-students group, empty or not', () => {
    assert.ok(groupDeletionBlocker({ ...empty, type: GROUP_TYPE.GLOBAL }));
  });
});

describe('groupEditBlocker', () => {
  it('leaves an ordinary group alone', () => {
    assert.equal(groupEditBlocker({ type: GROUP_TYPE.EXAM }, { name: 'SSC EVENING' }), null);
    assert.equal(groupEditBlocker({ type: GROUP_TYPE.SCHOLARSHIP }, { isActive: false }), null);
  });

  it('refuses to rename or retire the all-students group', () => {
    assert.match(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { name: 'EVERYONE' })!, /renamed/);
    assert.match(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { isActive: false })!, /retired/);
  });

  /**
   * Deliberately unlike `branchEditBlocker`, which permits a no-op patch on its protected row:
   * this row has no editable state at all, so re-setting a value it already holds is still refused.
   */
  it('refuses a patch that would change nothing', () => {
    assert.ok(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { isActive: true }));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups.unit.test.ts
```

Expected: `SyntaxError: … does not provide an export named 'groupEditBlocker'`.

- [ ] **Step 3: Implement** — replace `apps/api/src/groups/group-rules.ts` entirely:

```ts
import { GROUP_TYPE, type GroupType } from '@iace/contracts';

/** The rules that keep a group's membership and the group list trustworthy. */

export interface GroupUsage {
  type: GroupType;
  studentCount: number;
  testSeriesCount: number;
}

/** A group may only be deleted once nothing depends on it. */
export function groupDeletionBlocker(usage: GroupUsage): string | null {
  if (usage.type === GROUP_TYPE.GLOBAL) {
    return 'The all-students group is part of the system and cannot be deleted.';
  }
  if (usage.studentCount > 0) {
    return `This group still has ${usage.studentCount} student${usage.studentCount === 1 ? '' : 's'}. Move them to another group first.`;
  }
  if (usage.testSeriesCount > 0) {
    return 'This group is still linked to a test series. Unlink it first.';
  }
  return null;
}

/** Every student is in the all-students group, and nothing re-creates it. */
export function groupEditBlocker(
  group: { type: GroupType },
  changes: { name?: string; isActive?: boolean },
): string | null {
  if (group.type !== GROUP_TYPE.GLOBAL) return null;
  if (changes.name !== undefined) return 'The all-students group cannot be renamed.';
  // Both directions, and a no-op too: this row has no editable state at all.
  if (changes.isActive !== undefined) return 'The all-students group cannot be retired.';
  return null;
}
```

In `apps/api/src/groups/groups.service.ts`, change the import at `:19` to `import { groupDeletionBlocker } from './group-rules';` and replace `removeMember` (`:180-201`) with:

```ts
  /** Always allowed: a grant is not a floor, and a stale one must be removable. */
  async removeMember(id: string, studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { directGroupIds: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (!student.directGroupIds.includes(id))
      throw new AppException(ErrorCodes.NOT_FOUND, 'That student is not in this group');

    await this.prisma.student.update({
      where: { id: studentId },
      data: { directGroupIds: student.directGroupIds.filter((groupId) => groupId !== id) },
    });
  }
```

In `apps/api/src/students/students.service.ts`, replace `:185-196` with:

```ts
if (input.groupIds) {
  await this.assertGroupsExist(input.groupIds);
  this.assertMayJoinGroups(student, input.groupIds);
}
```

In `apps/admin/src/routes/student-detail.tsx`, replace the `CardDescription` at `:108-112` with:

```tsx
<CardDescription>
  Scholarship and non-IACE groups, granted to this student alone. Their exam batches come from their
  enrolments, not from here.
</CardDescription>
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups.unit.test.ts test/group-membership.unit.test.ts
```

Expected: `groups.unit.test.ts` green; `group-membership.unit.test.ts` still green (it never exercised the last-group refusal).

---

### Task 23: The group write path — `type`, `examType`, `branchIds`, and a name check that works

**Files:**
Create: `apps/api/test/groups-service.unit.test.ts`
Modify: `apps/api/test/support/fakes.ts` (`FakeStudent`, `StudentWhere`/`matchesStudent`, `FakeGroup`/`makeGroup`, `FakePrisma.group` — keeping commit 1's `groupBy` and `examType` count filter — and `FakePrisma.branch.findMany`), `apps/api/src/groups/groups.service.ts` (imports, `GroupRow`, constructor, `create`, `update`, `assertNameFree`, `toSummary`), `apps/api/src/groups/groups.module.ts`
Modify (the third constructor argument, `undefined as unknown as ExamTypesService`, at EVERY site that builds a `GroupsService` — these are all of them): `apps/api/test/group-membership.unit.test.ts:29`, `apps/api/test/module-facades.unit.test.ts` (the block commit 1 added), `apps/api/test/exam-types-service.unit.test.ts` (`serviceWith`)
Test: `apps/api/test/groups-service.unit.test.ts`

**Interfaces:**
Consumes: `ExamTypesService.assertUsable(codes: string[], fieldKey: string): Promise<void>`, `BranchesService.assertUsable(branchId: string): Promise<void>`.
Produces: `GroupsService.create(input: CreateGroupBody): Promise<GroupSummary>`, `GroupsService.update(id: string, input: UpdateGroupBody): Promise<GroupSummary>`, `GroupsService.assertNameFree(examType: string | null, name: string, exceptId?: string): Promise<void>` (private).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/groups-service.unit.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  GROUP_TYPE,
  createGroupSchema,
  type CreateGroupInput,
} from '@iace/contracts';
import { GroupsService } from '../src/groups/groups.service';
import { BranchesService } from '../src/branches/branches.service';
import { type ExamTypesService } from '../src/configs';
import { FakePrisma, makeBranch, makeGroup, makeStudent } from './support/fakes';

/**
 * The exam-type seam, stubbed rather than built: what matters here is that the group service asks,
 * and that it asks against the field the GROUP form owns.
 */
class StubExamTypes {
  readonly asked: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly known: string[] = ['SSC CGL', 'SSC CHSL']) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.asked.push({ codes, fieldKey });
    if (codes.every((code) => this.known.includes(code))) return Promise.resolve();
    return Promise.reject(
      new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam type', {
        fieldErrors: { [fieldKey]: ['No such exam type'] },
      }),
    );
  }

  asService(): ExamTypesService {
    return this as unknown as ExamTypesService;
  }
}

function serviceWith(
  groups = [] as ReturnType<typeof makeGroup>[],
  students = [] as ReturnType<typeof makeStudent>[],
) {
  const branches = [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })];
  const prisma = new FakePrisma(students, [], branches, groups, []);
  const examTypes = new StubExamTypes();
  const service = new GroupsService(
    prisma.asService(),
    new BranchesService(prisma.asService()),
    examTypes.asService(),
  );
  return { service, prisma, examTypes };
}

/** A body the way the controller's pipe would hand one over. */
const body = (over: Partial<CreateGroupInput> = {}) =>
  createGroupSchema.parse({
    name: 'SSC CGL MORNING',
    type: GROUP_TYPE.EXAM,
    examType: 'SSC CGL',
    branchIds: ['br_1'],
    ...over,
  });

describe('GroupsService — creating', () => {
  it('stores the type, the exam code and every branch', async () => {
    const { service, prisma } = serviceWith();

    const created = await service.create(body({ branchIds: ['br_1', 'br_2'] }));

    assert.equal(created.type, GROUP_TYPE.EXAM);
    assert.equal(created.examType, 'SSC CGL');
    assert.deepEqual(
      created.branches.map((branch) => branch.id),
      ['br_1', 'br_2'],
    );
    assert.equal(prisma.groups.length, 1);
  });

  it('validates the exam code against the catalog, keyed to the group form’s field', async () => {
    const { service, examTypes } = serviceWith();

    await service.create(body());

    assert.deepEqual(examTypes.asked, [{ codes: ['SSC CGL'], fieldKey: 'examType' }]);
  });

  it('refuses an unknown exam code rather than storing a dangling one', async () => {
    const { service, prisma } = serviceWith();

    const error = await service.create(body({ examType: 'SSC MTS' })).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.examType);
    assert.equal(prisma.groups.length, 0);
  });

  it('refuses a retired branch', async () => {
    const { service, prisma } = serviceWith();
    prisma.branches[1]!.isActive = false;

    const error = await service.create(body({ branchIds: ['br_2'] })).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.branchId);
  });

  /** Two SSC CGL MORNINGs under one exam are the same batch typed twice. */
  it('refuses a duplicate name within the exam, against the field', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g1', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }),
    ]);

    const error = await service.create(body()).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.name);
  });

  it('allows the same name under a different exam', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g1', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CHSL' }),
    ]);

    await assert.doesNotReject(() => service.create(body()));
  });
});

describe('GroupsService — updating', () => {
  const existing = () =>
    makeGroup({
      id: 'g1',
      name: 'SSC CGL MORNING',
      type: GROUP_TYPE.EXAM,
      examType: 'SSC CGL',
      branches: [{ id: 'br_1', name: 'AMEERPET', type: 'PHYSICAL' }],
    });

  it('moves a group between branches', async () => {
    const { service } = serviceWith([existing()]);

    const updated = await service.update('g1', { branchIds: ['br_2'] });

    assert.deepEqual(
      updated.branches.map((branch) => branch.id),
      ['br_2'],
    );
  });

  it('retires a group without touching anything else', async () => {
    const { service, prisma } = serviceWith([existing()]);

    const updated = await service.update('g1', { isActive: false });

    assert.equal(updated.isActive, false);
    assert.equal(prisma.groups[0]?.name, 'SSC CGL MORNING');
  });

  /**
   * The live bug this closes: the old check read the STORED exam code and skipped entirely unless the
   * name changed, so moving a group onto an exam that already had that name reached the unique index
   * and came back as a bare P2002 with nothing for the form to show.
   */
  it('refuses a move onto an exam that already has that name, against the field', async () => {
    const { service } = serviceWith([
      existing(),
      makeGroup({ id: 'g2', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CHSL' }),
    ]);

    const error = await service.update('g1', { examType: 'SSC CHSL' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.name);
  });

  /** Its own row is not a clash — a patch that renames nothing must still save. */
  it('lets a group keep the name it already has', async () => {
    const { service } = serviceWith([existing()]);

    await assert.doesNotReject(() => service.update('g1', { name: 'SSC CGL MORNING' }));
  });

  it('refuses to empty the branches of a group reached by an exam', async () => {
    const { service } = serviceWith([existing()]);

    const error = await service.update('g1', { branchIds: [] }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.branchIds);
  });

  it('refuses an exam code on a group that is granted one student at a time', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g3', name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP }),
    ]);

    const error = await service.update('g3', { examType: 'SSC CGL' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.examType);
  });

  it('refuses to rename or retire the all-students group', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g_all', name: 'ALL STUDENTS', type: GROUP_TYPE.GLOBAL }),
    ]);

    const error = await service.update('g_all', { isActive: false }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups-service.unit.test.ts
```

Expected: `TypeError: this.prisma.group.create is not a function` on the first create test, and `Expected 2 arguments, but got 3` from `tsc` on the `GroupsService` constructor.

- [ ] **Step 3: Extend the fakes** — in `apps/api/test/support/fakes.ts`: add `GROUP_TYPE`, `type GroupType` to the `@iace/contracts` import; add `enrolledExams: string[];` and `deletedAt: Date | null;` to `FakeStudent` (and `enrolledExams: [], deletedAt: null,` to `makeStudent`); then replace `StudentWhere`/`matchesStudent`, `FakeGroup`/`makeGroup`, `FakePrisma.group` and `FakePrisma.branch.findMany`.

```ts
/** The student filters the fakes answer: two `in` lookups, and the three ways a group reaches one. */
interface StudentWhere {
  id?: { in: string[] };
  mobile?: { in: string[] };
  directGroupIds?: { has: string };
  enrolledExams?: { has: string };
  deletedAt?: null;
}

function matchesStudent(student: FakeStudent, where: StudentWhere): boolean {
  return (
    (where.id?.in ? where.id.in.includes(student.id) : true) &&
    (where.mobile?.in ? where.mobile.in.includes(student.mobile) : true) &&
    (where.directGroupIds ? student.directGroupIds.includes(where.directGroupIds.has) : true) &&
    (where.enrolledExams ? student.enrolledExams.includes(where.enrolledExams.has) : true) &&
    (where.deletedAt === undefined ? true : student.deletedAt === null)
  );
}
```

```ts
export interface FakeGroup {
  id: string;
  name: string;
  type: GroupType;
  examType: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  branches: { id: string; name: string; type: BranchType }[];
  _count: { testSeries: number };
}

export function makeGroup(overrides: Partial<FakeGroup> = {}): FakeGroup {
  return {
    id: 'grp_1',
    name: 'SSC CGL MORNING',
    // The type that takes a student one at a time: most fakes here are grant paths.
    type: GROUP_TYPE.SCHOLARSHIP,
    examType: null,
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-05T09:30:00.000Z'),
    branches: [],
    ...overrides,
    // After the spread, so a caller passing only some fields still gets a count.
    _count: { testSeries: overrides._count?.testSeries ?? 0 },
  };
}

/** What the service writes: scalars, plus branches connected on create and replaced on update. */
interface GroupWriteData {
  name?: string;
  type?: GroupType;
  examType?: string | null;
  description?: string | null;
  isActive?: boolean;
  branches?: { connect?: { id: string }[]; set?: { id: string }[] };
}
```

Inside `FakePrisma`, replace `readonly group = { … }` with:

Keep the `groupBy` commit 1 added — `ExamTypesService.list` reads its page counts through it, and a
whole-block replacement without it makes every exam type report zero groups.

```ts
  /** Groups as the write and grant paths use them — the membership itself lives on the student. */
  readonly group = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.groups.find((g) => g.id === where.id) ?? null),

    groupBy: ({ where = {} }: { where?: { examType?: { in: string[] } } } = {}) => {
      const wanted = where.examType?.in;
      const counts = new Map<string, number>();
      for (const g of this.groups) {
        if (g.examType === null) continue;
        if (wanted && !wanted.includes(g.examType)) continue;
        counts.set(g.examType, (counts.get(g.examType) ?? 0) + 1);
      }
      return Promise.resolve(
        [...counts].map(([examType, total]) => ({ examType, _count: { _all: total } })),
      );
    },

    findFirst: ({
      where,
    }: {
      where: { name?: string; examType?: string | null; id?: { not: string } };
    }) =>
      Promise.resolve(
        this.groups.find(
          (g) =>
            (where.name === undefined || g.name === where.name) &&
            (where.examType === undefined || g.examType === where.examType) &&
            (where.id?.not === undefined || g.id !== where.id.not),
        ) ?? null,
      ),

    findMany: ({
      where = {},
    }: { where?: { id?: { in: string[] }; type?: { in: GroupType[] } } } = {}) =>
      Promise.resolve(
        this.groups.filter(
          (g) =>
            (!where.id?.in || where.id.in.includes(g.id)) &&
            (!where.type?.in || where.type.in.includes(g.type)),
        ),
      ),

    count: ({
      where = {},
    }: {
      where?: { id?: { in: string[] }; examType?: string; type?: { notIn: GroupType[] } };
    } = {}) =>
      Promise.resolve(
        this.groups.filter(
          (g) =>
            (!where.id?.in || where.id.in.includes(g.id)) &&
            (where.examType === undefined || g.examType === where.examType) &&
            (!where.type?.notIn || !where.type.notIn.includes(g.type)),
        ).length,
      ),

    create: ({ data }: { data: GroupWriteData }) => {
      const { branches, ...scalars } = data;
      const created = makeGroup({
        ...scalars,
        id: `grp_new_${this.nextId++}`,
        branches: this.branchRefs((branches?.connect ?? []).map((branch) => branch.id)),
      });
      this.groups.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: GroupWriteData }) => {
      const group = this.groups.find((g) => g.id === where.id);
      if (!group) throw new Error(`no group ${where.id}`);

      const { branches, ...scalars } = data;
      Object.assign(group, scalars);
      if (branches?.set) group.branches = this.branchRefs(branches.set.map((b) => b.id));
      return Promise.resolve(group);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.groups.findIndex((g) => g.id === where.id);
      const [removed] = this.groups.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  private branchRefs(ids: string[]): { id: string; name: string; type: BranchType }[] {
    return ids.map((id) => {
      const branch = this.branches.find((candidate) => candidate.id === id);
      return { id, name: branch?.name ?? id, type: branch?.type ?? BRANCH_TYPE.PHYSICAL };
    });
  }
```

and replace `branch.findMany` with:

```ts
    findMany: ({
      where = {},
    }: { where?: { isActive?: boolean; name?: { contains: string } } } = {}) =>
      Promise.resolve(
        this.branches.filter(
          (b) =>
            (where.isActive === undefined || b.isActive === where.isActive) &&
            (where.name?.contains === undefined ||
              b.name.toLowerCase().includes(where.name.contains.toLowerCase())),
        ),
      ),
```

- [ ] **Step 4: Implement the service** — in `apps/api/src/groups/groups.service.ts`: extend the `@iace/contracts` import with `groupShapeIssue`, `type GroupShapeIssue`; add `import { Inject, Injectable, forwardRef } from '@nestjs/common';`, `import { ExamTypesService } from '../configs';` and `groupEditBlocker` to the rules import; add `isActive: boolean;` to `GroupRow` and `isActive: row.isActive,` to `toSummary`; then:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchesService,
    // Mutual: `configs` counts groups per exam type, and groups validate against the catalog.
    @Inject(forwardRef(() => ExamTypesService))
    private readonly examTypes: ExamTypesService,
  ) {}
```

```ts
  async create(input: CreateGroupBody): Promise<GroupSummary> {
    await this.assertBranchesUsable(input.branchIds);
    if (input.examType) await this.examTypes.assertUsable([input.examType], 'examType');
    await this.assertNameFree(input.examType ?? null, input.name);

    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        type: input.type,
        examType: input.examType ?? null,
        description: input.description ?? null,
        branches: { connect: input.branchIds.map((id) => ({ id })) },
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(group, 0);
  }

  async update(id: string, input: UpdateGroupBody): Promise<GroupSummary> {
    const group = await this.requireGroup(id);

    const blocker = groupEditBlocker(group, input);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    this.assertShape(
      groupShapeIssue({ type: group.type, examType: input.examType, branchIds: input.branchIds }),
    );

    // Not `!== undefined`: clearing the code sends null, and the catalog has nothing to check.
    if (input.examType) await this.examTypes.assertUsable([input.examType], 'examType');
    if (input.branchIds) await this.assertBranchesUsable(input.branchIds);

    const examType = input.examType === undefined ? group.examType : input.examType;
    const name = input.name ?? group.name;
    if (name !== group.name || examType !== group.examType)
      await this.assertNameFree(examType, name, id);

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.examType === undefined ? {} : { examType: input.examType }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.branchIds
          ? { branches: { set: input.branchIds.map((branchId) => ({ id: branchId })) } }
          : {}),
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(updated, await this.studentCount(id));
  }

  private assertShape(issue: GroupShapeIssue | null): void {
    if (!issue) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, issue.message, {
      fieldErrors: { [issue.path]: [issue.message] },
    });
  }

  private async assertBranchesUsable(branchIds: readonly string[]): Promise<void> {
    await Promise.all(branchIds.map((branchId) => this.branches.assertUsable(branchId)));
  }

  private async requireGroup(id: string): Promise<GroupRow> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');
    return group;
  }
```

and replace `assertNameFree`:

```ts
  /**
   * Names are canonical by the time they arrive, so this compares the real thing. `exceptId` keeps a
   * group from clashing with itself; without the check the unique index answers with a bare P2002.
   */
  private async assertNameFree(
    examType: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    // findFirst, not the compound unique: a null examType matches no row through
    // a unique lookup, because in SQL one null never equals another.
    const clash = await this.prisma.group.findFirst({
      where: { examType, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'A group with this name already exists', {
        fieldErrors: { name: ['A group with this name already exists'] },
      });
    }
  }
```

In `apps/api/src/groups/groups.module.ts`, add `forwardRef` to the `@nestjs/common` import, `import { ConfigsModule } from '../configs';`, and change `imports` to `[PrismaModule, BranchesModule, forwardRef(() => ConfigsModule)]`.

In `apps/api/test/group-membership.unit.test.ts:29`, pass the third dependency (`addMembers` never reaches it):

```ts
    groups: new GroupsService(
      prisma.asService(),
      undefined as unknown as BranchesService,
      undefined as unknown as ExamTypesService,
    ),
```

with `import { type ExamTypesService } from '../src/configs';` added at the top.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test "test/**/*.test.ts"
```

Expected: `groups-service.unit.test.ts` green; `branches-service.unit.test.ts` still green now that `branch.findMany` honours its where.

---

### Task 24: Type-aware counting, everywhere the number is read

**Files:**
Modify: `apps/api/src/groups/groups.service.ts` (`list`, `detail`, `remove`, the two count privates), `apps/api/src/students/student-query.ts:1-19`, `apps/api/src/students/students.service.ts:45-46`
Test: `apps/api/test/groups-service.unit.test.ts` (append), `apps/api/test/student-query.unit.test.ts` (append)

**Interfaces:**
Produces: `GroupsService.studentCountFor(group: { id: string; type: GroupType; examType: string | null }): Prisma.PrismaPromise<number>`; `studentWhere(query: StudentListQuery, group?: GroupAccessRef | null): Prisma.StudentWhereInput`; `interface GroupAccessRef { id: string; type: GroupType; examType: string | null }`.

- [ ] **Step 1: Write the failing test** — append to `apps/api/test/groups-service.unit.test.ts`:

```ts
describe('GroupsService — who counts as a member', () => {
  const roster = [
    makeStudent({ id: 'stu_1', mobile: '9000000001', enrolledExams: ['SSC CGL'] }),
    makeStudent({ id: 'stu_2', mobile: '9000000002', enrolledExams: ['SSC CHSL'] }),
    makeStudent({ id: 'stu_3', mobile: '9000000003', directGroupIds: ['g_merit'] }),
  ];

  /**
   * The failure this exists to prevent: membership rows are gone, so counting `directGroupIds` made
   * every EXAM group report 0 — which let the delete blocker pass and told the admin "nobody loses
   * access" about a batch of thousands.
   */
  it('counts an exam group by the enrolment that reaches it', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const group = await service.detail('g1');

    assert.equal(group.studentCount, 1);
  });

  it('counts the all-students group as the whole live roster', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g_all', name: 'ALL STUDENTS', type: GROUP_TYPE.GLOBAL })],
      roster,
    );

    assert.equal((await service.detail('g_all')).studentCount, 3);
  });

  it('counts a scholarship group by its explicit grants', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g_merit', name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP })],
      roster,
    );

    assert.equal((await service.detail('g_merit')).studentCount, 1);
  });

  it('refuses to delete an exam group its enrolments still reach', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const error = await service.remove('g1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /1 student/);
    assert.equal(prisma.groups.length, 1);
  });

  it('deletes a group nothing reaches', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g_empty', name: 'MERIT 2027', type: GROUP_TYPE.SCHOLARSHIP })],
      roster,
    );

    await service.remove('g_empty');

    assert.equal(prisma.groups.length, 0);
  });

  it('carries the same number into the list', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const page = await service.list(groupListQuerySchema.parse({}));

    assert.equal(page.items[0]?.studentCount, 1);
  });
});
```

adding `groupListQuerySchema` to the `@iace/contracts` import at the top of that file.

Append to `apps/api/test/student-query.unit.test.ts`:

```ts
describe('studentWhere — the group filter follows the group’s type', () => {
  /** The Groups screen links its name to this list, so the two must return the same people. */
  it('finds an exam group’s members by their enrolment', () => {
    const where = studentWhere(query({ groupId: 'g1' }), {
      id: 'g1',
      type: GROUP_TYPE.EXAM,
      examType: 'SSC CGL',
    });

    assert.deepEqual(where.AND, [{ enrolledExams: { has: 'SSC CGL' } }]);
  });

  it('finds the all-students group as everybody still on the roster', () => {
    const where = studentWhere(query({ groupId: 'g_all' }), {
      id: 'g_all',
      type: GROUP_TYPE.GLOBAL,
      examType: null,
    });

    assert.deepEqual(where.AND, [{ deletedAt: null }]);
  });

  it('finds a scholarship group through the grants on the student', () => {
    const where = studentWhere(query({ groupId: 'g_merit' }), {
      id: 'g_merit',
      type: GROUP_TYPE.SCHOLARSHIP,
      examType: null,
    });

    assert.deepEqual(where.AND, [{ directGroupIds: { has: 'g_merit' } }]);
  });

  /** A group deleted out from under the link: the dangling grant is still the honest answer. */
  it('falls back to the grant column when the group is gone', () => {
    assertHas({ groupId: 'g1' }, { directGroupIds: { has: 'g1' } });
  });
});
```

adding `GROUP_TYPE` to the `@iace/contracts` import at `:3`.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups-service.unit.test.ts test/student-query.unit.test.ts
```

Expected: `AssertionError: 0 !== 1` on the exam-group count, and `[ { directGroupIds: { has: 'g1' } } ] deepEqual [ { enrolledExams: { has: 'SSC CGL' } } ]` on the roster filter.

- [ ] **Step 3: Implement** — in `apps/api/src/groups/groups.service.ts`, add `GROUP_REACH`, `groupReach` to the `@iace/contracts` import, replace the two count privates with one public method, and rewire `list`/`detail`/`remove`:

In `list`, the new filter joins the where clause it already builds:

```ts
      ...(query.acceptsGrants ? { type: { in: [...GROUP_TYPES_ACCEPTING_GRANTS] } } : {}),
```

adding `GROUP_TYPES_ACCEPTING_GRANTS` to the same `@iace/contracts` import.

```ts
  /** Who is in a group depends on its type — an enrolment, everybody, or an explicit grant. */
  studentCountFor(group: Pick<GroupRow, 'id' | 'type' | 'examType'>): Prisma.PrismaPromise<number> {
    const reach = groupReach(group);
    if (reach === GROUP_REACH.EVERYONE)
      return this.prisma.student.count({ where: { deletedAt: null } });
    if (reach === GROUP_REACH.ENROLMENT && group.examType)
      return this.prisma.student.count({ where: { enrolledExams: { has: group.examType } } });
    return this.prisma.student.count({ where: { directGroupIds: { has: group.id } } });
  }
```

In `list`, replace the `studentCounts` call and the mapping with:

```ts
const counts = await this.prisma.$transaction(rows.map((row) => this.studentCountFor(row)));

return {
  items: rows.map((row, index) => toSummary(row, counts[index] ?? 0)),
  page: query.page,
  pageSize: query.pageSize,
  total,
};
```

In `detail`, `return toSummary(group, await this.studentCountFor(group));` (via `requireGroup`), and in `remove`:

```ts
const group = await this.requireGroup(id);

const blocker = groupDeletionBlocker({
  type: group.type,
  studentCount: await this.studentCountFor(group),
  testSeriesCount: group._count.testSeries,
});
```

In `apps/api/src/students/student-query.ts`, replace the imports and the `groupId` line:

```ts
import { Prisma } from '@prisma/client';
import {
  GROUP_REACH,
  STUDENT_SORTS,
  groupReach,
  type GroupType,
  type StudentListQuery,
  type StudentSort,
} from '@iace/contracts';

/** Enough of a group to know how it reaches its students. */
export interface GroupAccessRef {
  id: string;
  type: GroupType;
  examType: string | null;
}

/** Turns the roster's filters into a Prisma query. */
export function studentWhere(
  query: StudentListQuery,
  group?: GroupAccessRef | null,
): Prisma.StudentWhereInput {
```

```ts
if (query.groupId) add(membersOf(query.groupId, group));
```

and add beside `dateRange`:

```ts
/** The same three cases `GroupsService.studentCountFor` counts, so the link and the count agree. */
function membersOf(
  groupId: string,
  group: GroupAccessRef | null | undefined,
): Prisma.StudentWhereInput {
  if (!group) return { directGroupIds: { has: groupId } };

  const reach = groupReach(group);
  if (reach === GROUP_REACH.EVERYONE) return { deletedAt: null };
  if (reach === GROUP_REACH.ENROLMENT && group.examType)
    return { enrolledExams: { has: group.examType } };
  return { directGroupIds: { has: group.id } };
}
```

In `apps/api/src/students/students.service.ts`, change `list` and add the lookup:

```ts
const where = studentWhere(query, await this.groupFilter(query.groupId));
```

```ts
  /** One lookup before the where-clause: the group's type decides who counts as being in it. */
  private async groupFilter(groupId: string | undefined): Promise<GroupAccessRef | null> {
    if (!groupId) return null;
    return this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, type: true, examType: true },
    });
  }
```

with the import at `:24` widened to `import { studentOrderBy, studentWhere, type GroupAccessRef } from './student-query';`.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test "test/**/*.test.ts"
```

---

### Task 25: Close all four grant paths

**Files:**
Modify: `apps/api/src/groups/groups.service.ts` (`addMembers`), `apps/api/src/students/students.service.ts` (`update`, new private), `apps/api/src/imports/group-member-import.ts:14-53`, `apps/api/src/imports/imports.service.ts:164-170` and `:210-220`, `apps/api/src/imports/student-import.ts:65-79`
Test: `apps/api/test/groups-service.unit.test.ts` (append), `apps/api/test/group-membership.unit.test.ts` (append), `apps/api/test/group-member-import.unit.test.ts:10-19` (fixture) + append, `apps/api/test/imports.unit.test.ts` (append)

**Interfaces:**
Consumes: `acceptsDirectGrants`, `GROUP_TYPES_ACCEPTING_GRANTS`, `DIRECT_GRANT_MESSAGE`.
Produces: `GroupMemberContext.group: GroupRef & { type: GroupType }`; `StudentsService.assertGroupsAcceptGrants(current: string[], requested: string[]): Promise<void>` (private).

- [ ] **Step 1: Write the failing test** — append to `apps/api/test/groups-service.unit.test.ts`:

```ts
describe('GroupsService.addMembers — only the types a grant means anything for', () => {
  /**
   * The failure this prevents: a student added to an EXAM group gains a row that grants nothing,
   * because access to that group comes from their enrolment. The click reports success.
   */
  it('refuses to grant an exam group one student at a time', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      [makeStudent({ id: 'stu_1' })],
    );

    const error = await service.addMembers('g1', ['stu_1']).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.studentIds);
    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });

  it('grants a scholarship group', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g_merit', type: GROUP_TYPE.SCHOLARSHIP })],
      [makeStudent({ id: 'stu_1' })],
    );

    await service.addMembers('g_merit', ['stu_1']);

    assert.deepEqual(prisma.students[0]?.directGroupIds, ['g_merit']);
  });

  /** A stale grant must always be removable, whatever the group turned out to be. */
  it('still removes a student from a group that no longer takes grants', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      [makeStudent({ id: 'stu_1', directGroupIds: ['g1'] })],
    );

    await service.removeMember('g1', 'stu_1');

    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });
});
```

Append to `apps/api/test/group-membership.unit.test.ts`:

```ts
describe('StudentsService.update — the grant path from the detail form', () => {
  it('refuses to add a group that is reached by an enrolment', async () => {
    const { studentsService, prisma } = servicesWith(
      [active()],
      [makeGroup({ id: MORNING, type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
    );

    const error = await studentsService
      .update('stu_active', { groupIds: [MORNING] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.groupIds);
    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });

  /** Diffed against what they hold: a grant made before the rule existed is still removable. */
  it('lets a stale grant be dropped without re-checking it', async () => {
    const { studentsService, prisma } = servicesWith(
      [active({ directGroupIds: [MORNING, EVENING] })],
      [
        makeGroup({ id: MORNING, type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }),
        makeGroup({ id: EVENING, type: GROUP_TYPE.SCHOLARSHIP }),
      ],
    );

    await studentsService.update('stu_active', { groupIds: [EVENING] });

    assert.deepEqual(prisma.students[0]?.directGroupIds, [EVENING]);
  });
});
```

with `GROUP_TYPE` added to its `@iace/contracts` import.

In `apps/api/test/group-member-import.unit.test.ts`, add `GROUP_TYPE` and `DIRECT_GRANT_MESSAGE` to a new `@iace/contracts` import, change the fixture group at `:11` to
`group: { id: 'g1', name: 'MERIT 2026', examType: null, type: GROUP_TYPE.SCHOLARSHIP },`
and append:

```ts
describe('planGroupMemberImport — a group a sheet cannot grant', () => {
  /**
   * A file-level refusal, not a row error: the group is fixed for the whole upload, so two hundred
   * identical red lines would say the same thing two hundred times and inflate the invalid count.
   */
  it('refuses the whole file for a group reached by an enrolment', () => {
    const result = planGroupMemberImport(readCsvTable('Mobile Number\n9876543210'), {
      ...context(),
      group: { id: 'g2', name: 'SSC CGL MORNING', examType: 'SSC CGL', type: GROUP_TYPE.EXAM },
    });

    assert.deepEqual(result.fileErrors, [DIRECT_GRANT_MESSAGE]);
    assert.deepEqual(result.rows, []);
    assert.equal(result.summary.willAdd, 0);
  });
});
```

Append to `apps/api/test/imports.unit.test.ts`:

```ts
describe('resolveGroup — an ambiguous name with no exam to tell them apart', () => {
  /** The old message interpolated a null and read "write it as null / MERIT 2026". */
  it('never offers a qualified form it cannot build', () => {
    const plan = planStudentImport(readCsvTable('mobile,groups\n9876543210,MERIT 2026'), {
      existingByMobile: new Map(),
      groupsByName: new Map([
        [
          'MERIT 2026',
          [
            { id: 'g_a', name: 'MERIT 2026', examType: null },
            { id: 'g_b', name: 'MERIT 2026', examType: null },
          ],
        ],
      ]),
    });

    const error = plan.rows[0]?.errors[0] ?? '';
    assert.equal(plan.rows[0]?.action, 'skip');
    assert.doesNotMatch(error, /null/);
    assert.match(error, /more than one/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test test/groups-service.unit.test.ts test/group-membership.unit.test.ts test/group-member-import.unit.test.ts test/imports.unit.test.ts
```

Expected: `Promise resolved instead of rejecting` on the addMembers and update refusals; `fileErrors deepEqual []`; `The input did not match the regular expression /more than one/`.

- [ ] **Step 3: Implement** — in `apps/api/src/groups/groups.service.ts`, add `DIRECT_GRANT_MESSAGE`, `acceptsDirectGrants` to the contracts import and replace the head of `addMembers`:

```ts
const group = await this.prisma.group.findUnique({
  where: { id },
  select: { id: true, type: true },
});
if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

if (!acceptsDirectGrants(group.type)) {
  throw new AppException(ErrorCodes.CONFLICT, DIRECT_GRANT_MESSAGE, {
    fieldErrors: { studentIds: [DIRECT_GRANT_MESSAGE] },
  });
}
```

In `apps/api/src/students/students.service.ts`, add `DIRECT_GRANT_MESSAGE`, `GROUP_TYPES_ACCEPTING_GRANTS` to the contracts import, call the new check in `update`, and add the private:

```ts
if (input.groupIds) {
  await this.assertGroupsExist(input.groupIds);
  await this.assertGroupsAcceptGrants(student.directGroupIds, input.groupIds);
  this.assertMayJoinGroups(student, input.groupIds);
}
```

```ts
  /** Only the groups this save would ADD, so a grant made before the rule is still removable. */
  private async assertGroupsAcceptGrants(current: string[], requested: string[]): Promise<void> {
    const already = new Set(current);
    const joining = requested.filter((id) => !already.has(id));
    if (joining.length === 0) return;

    const refused = await this.prisma.group.count({
      where: { id: { in: joining }, type: { notIn: [...GROUP_TYPES_ACCEPTING_GRANTS] } },
    });
    if (refused > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, DIRECT_GRANT_MESSAGE, {
        fieldErrors: { groupIds: [DIRECT_GRANT_MESSAGE] },
      });
    }
  }
```

In `apps/api/src/imports/group-member-import.ts`, widen the context and refuse up front:

```ts
export interface GroupMemberContext {
  group: GroupRef & { type: GroupType };
  /** Mobile → the student it resolves to, for the numbers this file lists. */
  studentsByMobile: Map<string, { id: string; fullName: string | null; isActive: boolean }>;
  /** Who is in the group already. */
  memberIds: Set<string>;
}

export function planGroupMemberImport(
  table: CsvTable,
  context: GroupMemberContext,
): GroupMemberImportPlan {
  const { type, ...group } = context.group;
  const empty = { total: 0, willAdd: 0, alreadyMembers: 0, invalid: 0 };

  if (!acceptsDirectGrants(type)) {
    return { group, rows: [], summary: empty, fileErrors: [DIRECT_GRANT_MESSAGE] };
  }

  if (table.headers.length === 0) {
    return { group, rows: [], summary: empty, fileErrors: ['That file is empty'] };
  }

  const fileErrors = [...missingHeaders(table.headers), ...tooManyRows(table)];
  if (fileErrors.length > 0) return { group, rows: [], summary: empty, fileErrors };

  // A number listed twice would otherwise be counted as two additions while
  // only ever being one.
  const seenInFile = new Map<string, number>();
  const rows = table.rows.map((row) => planRow(row, context, seenInFile));

  return {
    group,
    rows,
    summary: {
      total: rows.length,
      willAdd: rows.filter((r) => r.action === 'add').length,
      alreadyMembers: rows.filter((r) => r.action === 'already').length,
      invalid: rows.filter((r) => r.action === 'skip').length,
    },
    fileErrors: [],
  };
}
```

adding `DIRECT_GRANT_MESSAGE`, `acceptsDirectGrants`, `type GroupRef`, `type GroupType` to its `@iace/contracts` import.

In `apps/api/src/imports/imports.service.ts`, add `GROUP_TYPES_ACCEPTING_GRANTS` to the contracts import, extend the select at `:167` to `select: { id: true, name: true, examType: true, type: true },`, and make an ineligible group simply not resolve at `:218`:

```ts
      groupNames.length
        ? this.prisma.group.findMany({
            // A roster grants groups student by student, so only the types that means anything for
            // are loadable. Anything else falls through to "No group called X".
            where: { type: { in: [...GROUP_TYPES_ACCEPTING_GRANTS] } },
            select: { id: true, name: true, examType: true },
          })
        : Promise.resolve([]),
```

In `apps/api/src/imports/student-import.ts`, replace the ambiguity branch at `:75-78`:

```ts
const exams = matches
  .map((group) => group.examType)
  .filter((examCode): examCode is string => examCode !== null);

if (exams.length === 0) {
  return {
    error: `More than one group is called "${name}" — rename one of them, or add these students from the group's own screen`,
  };
}

return {
  error: `"${name}" exists under more than one exam (${exams.join(', ')}) — write it as "${exams[0]} ${EXAM_QUALIFIER} ${name}"`,
};
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json node --import tsx --test "test/**/*.test.ts"
```

---

### Task 26: The Groups screen — type, exam, branches, retire

**Files:**
Modify: `apps/admin/src/routes/groups.tsx` (whole file), `apps/admin/src/lib/constants.ts` (add `GROUP_TYPE_LABELS`), `packages/ui/test/confirm-destructive.test.ts` (the `toggles` map)
Test: `packages/ui/test/confirm-destructive.test.ts`

**Interfaces:**
Consumes: `useExamTypes({ activeOnly: true }): ExamType[]`, `useBranches({ activeOnly: true }): Branch[]`, `MultiCombobox`, `Combobox`, `api.admin.groups.update(id, { isActive })`.
Produces: `GROUP_TYPE_LABELS: Record<GroupType, string>`.

- [ ] **Step 1: Write the failing test** — in `packages/ui/test/confirm-destructive.test.ts`, add the groups screen to the `toggles` map:

```ts
const toggles = {
  'apps/admin/src/routes/admins.tsx': 'Reactivate',
  'apps/admin/src/routes/student-detail.tsx': 'Reactivate student',
  'apps/admin/src/routes/branches.tsx': 'Reactivate branch',
  'apps/admin/src/routes/exam-types.tsx': 'Reactivate exam type',
  'apps/admin/src/routes/groups.tsx': 'Reactivate group',
};
```

**Add the groups line, do not retype the object.** The exam-types entry came from commit 1; a whole-object
replacement here would silently delete it and the gate would go quiet on that screen.

```ts

```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/packages/ui && pnpm test
```

Expected: `apps/admin/src/routes/groups.tsx: the reverse direction must reach a ConfirmDialog too`.

- [ ] **Step 3: Implement** — in `apps/admin/src/lib/constants.ts`, add `GROUP_TYPE` and `type GroupType` to the `@iace/contracts` import and, below `ROUTES`:

```ts
/** What a group type is called on screen. */
export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  [GROUP_TYPE.GLOBAL]: 'All students',
  [GROUP_TYPE.EXAM]: 'Exam',
  [GROUP_TYPE.PROGRAM]: 'Program',
  [GROUP_TYPE.SCHOLARSHIP]: 'Scholarship',
  [GROUP_TYPE.NON_IACE]: 'Non-IACE',
};
```

In `apps/admin/src/routes/groups.tsx`: extend the `@iace/contracts` import with `CREATABLE_GROUP_TYPES`, `GROUP_TYPE`, `acceptsDirectGrants`, `requiresExamType`, `plural` stays from `@iace/ui`, add `Combobox`, `MultiCombobox` to the `@iace/ui` import, `Power` to the lucide import, `useWatch` to the react-hook-form import, `GROUP_TYPE_LABELS` to the constants import, and `import { useExamTypes } from '../lib/use-exam-types';`. Then replace `NEW_GROUP_FIELDS`, `groupColumns`, `NewGroupCard` and `GroupActions`:

```tsx
const NEW_GROUP_FIELDS = ['name', 'type', 'examType', 'branchIds'] as const;

/** One question at a time: two booleans could render two dialogs at once. */
const GROUP_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type GroupConfirm = (typeof GROUP_CONFIRMS)[keyof typeof GROUP_CONFIRMS];

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function groupColumns(refresh: () => void): DataTableColumn<GroupSummary>[] {
  return [
    {
      key: 'name',
      header: 'Group',
      className: 'font-medium',
      // Members are the student list filtered — the same screen, not a copy.
      cell: (group) => (
        <Link to={`${ROUTES.STUDENTS}?groupId=${group.id}`} className={linkVariants()}>
          {group.name}
        </Link>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (group) => <Badge variant="neutral">{GROUP_TYPE_LABELS[group.type]}</Badge>,
    },
    {
      key: 'exam',
      header: 'Exam',
      cell: (group) => group.examType ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'branches',
      header: 'Branches',
      cell: (group) => <BranchesCell branches={group.branches} />,
    },
    { key: 'students', header: 'Students', numeric: true, cell: (g) => g.studentCount },
    { key: 'series', header: 'Test series', numeric: true, cell: (g) => g.testSeriesCount },
    { key: 'status', header: 'Status', cell: (group) => <GroupStatus group={group} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (group) => <GroupRowActions group={group} onChanged={refresh} />,
    },
  ];
}

/** Three states, listed. See BranchStatus in branches.tsx for the reasoning. */
function GroupStatus({ group }: Readonly<{ group: GroupSummary }>) {
  if (group.type === GROUP_TYPE.GLOBAL) return <Badge variant="info">System</Badge>;
  if (group.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}
```

```tsx
function NewGroupCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateGroupInput>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '', type: GROUP_TYPE.EXAM, examType: undefined, branchIds: [] },
  });

  const type = useWatch({ control: form.control, name: 'type' });
  const examType = useWatch({ control: form.control, name: 'examType' });
  const branchIds = useWatch({ control: form.control, name: 'branchIds' }) ?? [];
  const reachedByExam = requiresExamType(type);

  // Only ACTIVE ones: a closed centre and a retired exam stay in the list for
  // what already references them, but nothing new is created under one.
  const branches = useBranches({ activeOnly: true });
  const examTypes = useExamTypes({ activeOnly: true });

  const create = useMutation({
    meta: { success: 'Group created.', fields: NEW_GROUP_FIELDS },
    mutationFn: (values: CreateGroupInput) => api.admin.groups.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_GROUP_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New group</CardTitle>
        <CardDescription>
          The type decides who reaches it: an exam group takes everybody enrolled in that exam, a
          scholarship group takes the students you put in it. Names are stored in capitals, so “SSC
          CGL Morning” and “ssc cgl morning” are the same group.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="type" label="Type" className="min-w-44 flex-1">
            {(control) => (
              <Select
                {...control}
                autoFocus
                onChange={(event) => {
                  void control.onChange(event);
                  if (!requiresExamType(event.target.value as GroupSummary['type'])) {
                    form.setValue('examType', undefined);
                    form.setValue('branchIds', []);
                  }
                }}
              >
                {CREATABLE_GROUP_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {GROUP_TYPE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {reachedByExam ? (
            <FormField
              form={form}
              name="examType"
              label="Exam"
              hint="Students enrolled in this exam reach the group."
              className="min-w-48 flex-1"
            >
              {({ id }) => (
                <Combobox
                  id={id}
                  aria-label="Exam"
                  value={examType ?? ''}
                  onChange={(next) =>
                    form.setValue('examType', next || undefined, { shouldValidate: true })
                  }
                  items={examTypes.map((exam) => ({
                    value: exam.code,
                    label: exam.name,
                    hint: exam.code,
                  }))}
                  placeholder="Pick the exam…"
                  emptyLabel="No active exam type"
                />
              )}
            </FormField>
          ) : null}

          {reachedByExam ? (
            <FormField form={form} name="branchIds" label="Branches" className="min-w-56 flex-1">
              {({ id }) => (
                <MultiCombobox
                  id={id}
                  aria-label="Branches"
                  value={branchIds}
                  onChange={(next) => form.setValue('branchIds', next, { shouldValidate: true })}
                  items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                  placeholder="Pick the centres…"
                  emptyLabel="No active branch"
                />
              )}
            </FormField>
          ) : null}

          <FormField form={form} name="name" label="Group name" className="min-w-56 flex-1">
            {(control) => (
              // Shown in capitals as it is typed, because that is what will be
              // stored — the preview would otherwise disagree with the result.
              <Input
                {...control}
                className="uppercase placeholder:normal-case"
                placeholder="SSC CGL MORNING"
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}
```

```tsx
/** The buttons only ask; both dialogs live with the mutations in `GroupRowActions`. */
function GroupActions({
  group,
  busy,
  onAsk,
}: Readonly<{ group: GroupSummary; busy: boolean; onAsk: (confirm: GroupConfirm) => void }>) {
  if (group.type === GROUP_TYPE.GLOBAL) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {/* Only the types a grant means anything for. An exam group is reached by
          an enrolment, so there is nobody to add here. */}
      {acceptsDirectGrants(group.type) ? (
        <Button size="sm" variant="outline" asChild>
          <Link to={ROUTES.IMPORT_GROUP_MEMBERS(group.id)}>
            <UserPlus aria-hidden />
            Add students
          </Link>
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(GROUP_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {group.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${group.name}`}
        disabled={busy}
        onClick={() => onAsk(GROUP_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}

function GroupRowActions({
  group,
  onChanged,
}: Readonly<{ group: GroupSummary; onChanged: () => void }>) {
  const [asking, setAsking] = useState<GroupConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${group.name} deleted.` },
    mutationFn: () => api.admin.groups.remove(group.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${group.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.groups.update(group.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <GroupActions
        group={group}
        busy={busy}
        onAsk={(confirm) => {
          // Clear the last refusal: it described the group as it was before the
          // admin went and moved the students.
          remove.reset();
          setAsking(confirm);
        }}
      />

      {/* Retiring is reversible and still asks: nothing about this row changes
          except a badge, and the consequence lands later on somebody else. */}
      <ConfirmDialog
        open={asking === GROUP_CONFIRMS.RETIRE}
        onOpenChange={close}
        loading={setActive.isPending}
        title={
          group.isActive ? `Retire ${qualifiedGroupName(group)}?` : `Reactivate ${group.name}?`
        }
        description={
          group.isActive
            ? `${plural(group.studentCount, 'student')} keep the access they have. The group takes no new students and stops being offered when a test series is set up.`
            : 'The group is offered again and can take new students.'
        }
        confirmLabel={group.isActive ? 'Retire group' : 'Reactivate group'}
        onConfirm={() => setActive.mutate(!group.isActive)}
      />

      {/* A group is how a student reaches a test, so deleting one takes access
          away from everybody in it. The member count is the part that changes
          the answer: nobody deletes a batch of 240 by accident twice. */}
      <ConfirmDialog
        open={asking === GROUP_CONFIRMS.DELETE}
        onOpenChange={close}
        destructive
        loading={remove.isPending}
        title={`Delete ${qualifiedGroupName(group)}?`}
        description={
          group.studentCount === 0
            ? 'The group is empty, so nobody loses access. This cannot be undone.'
            : `${plural(group.studentCount, 'student')} reach their tests through this group and will lose that access. The students themselves are not deleted. This cannot be undone.`
        }
        confirmLabel="Delete group"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
```

and in `GroupsPage`, replace the memo with a refresh the rows can call:

```tsx
const refresh = useCallback(
  () => void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
  [queryClient],
);

const columns = useMemo(() => groupColumns(refresh), [refresh]);
```

adding `useCallback` to the React import.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace && pnpm --filter @iace/ui test && pnpm --filter @iace/admin typecheck
```

---

### Task 27: Gates, SonarQube, and the commit

**Files:** none created; this task stages and commits everything from Tasks 20-26.

**Interfaces:** none.

- [ ] **Step 1: Format and run every gate**

```bash
cd /Users/harshithdiyyala/Projects/iace && node --version && pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: Node v22.x, and every task green. Fix causes, never skips.

- [ ] **Step 2: Check what is actually staged**

```bash
cd /Users/harshithdiyyala/Projects/iace && git status --short && git branch --show-current
```

Expected: `main`, the eleven modified files plus the three created ones, and the untracked `packages/contracts/src/questions.ts` and `docs/04-students-groups-access-model.md`.

- [ ] **Step 3: Move the untracked file the scanner trips on out of the tree**

```bash
cd /Users/harshithdiyyala/Projects/iace && cp packages/contracts/src/questions.ts /tmp/iace-questions-stash.ts && rm packages/contracts/src/questions.ts && ls -l /tmp/iace-questions-stash.ts
```

The scanner reads the working tree, not the index, and this file fails the gate on `typescript:S3776`. It is not part of this change and comes straight back in Step 5 (done twice already this session, sha `035d7a2e`).

- [ ] **Step 4: Stage whole files and commit**

```bash
cd /Users/harshithdiyyala/Projects/iace && git add prisma/schema.prisma prisma/migrations/20260818120000_group_state_and_singletons README.md packages/contracts/src/groups.ts packages/contracts/src/naming.ts packages/contracts/src/students.ts packages/ui/test/confirm-destructive.test.ts apps/api/src/groups apps/api/src/configs apps/api/src/students apps/api/src/imports apps/api/test apps/admin/src/routes/groups.tsx apps/admin/src/routes/student-detail.tsx apps/admin/src/lib/constants.ts && git diff --stat && git commit -m "feat(groups): make a group's type, exam and branches settable" -m "A group's type decides how it finds its students, and nothing wrote it: every
group was EXAM with a null exam code, so an enrolment matched nothing and a
count over directGroupIds reported 0 for batches of thousands. The delete
dialog then told the admin 'the group is empty, so nobody loses access'.

Group.isActive lands with the migration that settles the two singletons the
model assumes. The ALL STUDENTS group is seeded — nothing else creates it.
The virtual branch already existed, created by an earlier migration and
typed VIRTUAL by another, so it is renamed from GLOBAL to ONLINE rather
than inserted: the old name described the isGlobal flag that no longer
exists, and branchEditBlocker deliberately refuses that rename through the
UI. Both statements are guarded so a second run changes nothing.

studentCount, the deletion blocker, the confirm dialog and the roster's
group filter now run one rule (groupReach): an enrolment, the whole roster,
or an explicit grant. The Groups screen's click-the-name link stops landing
on a blank roster for every exam group.

Direct grants are refused for the types a grant means nothing for, on all
four paths that hand one out - addMembers, the student detail form, the
group-member sheet and the roster sheet's Groups column - diffed against
what the student already holds, so a stale grant can always be removed.

canRemoveFromGroup is deleted. It refused to strip a student's last entry in
an array that now holds only scholarship and non-IACE grants, blocking a
revoke that took nothing away.

assertNameFree took the STORED exam code and skipped entirely unless the name
changed, so moving a group onto an exam that already had that name reached
the unique index and came back as a bare P2002 with nothing for the form to
show. It now takes the requested code and an exceptId." && git log --oneline -1
```

- [ ] **Step 5: Restore the untracked file byte-identically**

```bash
cd /Users/harshithdiyyala/Projects/iace && cp /tmp/iace-questions-stash.ts packages/contracts/src/questions.ts && git status --short && rm /tmp/iace-questions-stash.ts
```

Expected: `?? packages/contracts/src/questions.ts` and `?? docs/04-students-groups-access-model.md` are the only entries.

---

### Task 40: Contracts — the student access fields, the test-block route, the client method

**Files:**

- Modify: `packages/contracts/src/students.ts` (summary at :72-84, create at :207-215, update at :237-246, list query at :161-181, routes at :255-262)
- Modify: `packages/contracts/src/client.ts` (`admin.students` block at :418-447)
- Modify: `apps/api/test/students.unit.test.ts` (the `detail` fixture at :97-110, which five cases parse — it gains `studentType: STUDENT_TYPE.OFFLINE, enrolledExams: [], isTestBlocked: false, program: null, currentBranchId: null`, or every one of them fails on the newly required fields)
- Test: Create `packages/contracts/test/students.test.ts`

**Interfaces:**

- Consumes: `studentTypeSchema`/`STUDENT_TYPE` (already in `students.ts`), `paginationQuerySchema`, `blankIsAbsent`, `blankClears`, `optionalBoolean`
- Produces: `PROGRAM_MAX = 120`; `STUDENT_TYPES = studentTypeSchema.options` (the picker list, beside `GENDERS`); `studentSummarySchema` gains `studentType: StudentType`, `enrolledExams: string[]`, `isTestBlocked: boolean`; `studentDetailSchema` gains `program: string | null`, `currentBranchId: string | null`; `createStudentSchema` / `updateStudentSchema` gain `studentType`, `enrolledExams`, `program`, `currentBranchId`; `studentListQuerySchema` gains `isTestBlocked`; `setStudentTestBlockedSchema` → `SetStudentTestBlockedBody`; `ADMIN_STUDENT_ROUTES.setTestBlocked(id: string) => string`; `api.admin.students.setTestBlocked(id: string, input: SetStudentTestBlockedBody): Promise<StudentDetail>`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/students.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_STUDENT_ROUTES,
  PROGRAM_MAX,
  STUDENT_TYPE,
  createStudentSchema,
  setStudentTestBlockedSchema,
  studentListQuerySchema,
  studentSummarySchema,
  updateStudentSchema,
} from '../src/students';

const summary = {
  id: 'stu_1',
  mobile: '9876543210',
  fullName: 'Ravi Kumar',
  studentType: STUDENT_TYPE.OFFLINE,
  enrolledExams: ['SSC CGL'],
  isActive: true,
  isTestBlocked: false,
  hasSignedIn: true,
  hasDefaultPin: false,
  preTestReady: true,
  profileCompleted: false,
  groups: [],
  createdAt: '2026-01-05T09:30:00.000Z',
};

describe('createStudentSchema — what a student is here for', () => {
  /**
   * The failure this prevents: a student created with no type at all, which is what the ONLINE
   * hardcode did to every student the admin screen and the sync path ever made. Type decides which
   * branch and which groups they may hold, so nothing may guess it.
   */
  it('refuses a student with no type', () => {
    const parsed = createStudentSchema.safeParse({ mobile: '9876543210' });

    assert.equal(parsed.success, false);
    assert.ok(parsed.error?.issues.some((issue) => issue.path[0] === 'studentType'));
  });

  it('takes enrolments, a programme and a branch alongside the type', () => {
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL', 'RRB JE'],
      program: 'One year classroom',
      currentBranchId: 'br_1',
    });

    assert.deepEqual(parsed.enrolledExams, ['SSC CGL', 'RRB JE']);
    assert.equal(parsed.program, 'One year classroom');
    assert.equal(parsed.currentBranchId, 'br_1');
  });

  it('reads an untouched programme box as "not known yet", not as an empty programme', () => {
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
      program: '   ',
    });

    assert.equal(parsed.program, undefined);
  });

  it('caps the programme at the column width', () => {
    const tooLong = {
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
      program: 'x'.repeat(PROGRAM_MAX + 1),
    };

    assert.equal(createStudentSchema.safeParse(tooLong).success, false);
  });
});

describe('updateStudentSchema — a patch, where a cleared box clears the field', () => {
  it('leaves an omitted key alone', () => {
    const parsed = updateStudentSchema.parse({});

    assert.equal(parsed.studentType, undefined);
    assert.equal(parsed.enrolledExams, undefined);
    assert.equal(parsed.program, undefined);
    assert.equal(parsed.currentBranchId, undefined);
  });

  it('clears the programme and the branch when the box is emptied', () => {
    const parsed = updateStudentSchema.parse({ program: '', currentBranchId: '' });

    assert.equal(parsed.program, null);
    assert.equal(parsed.currentBranchId, null);
  });

  it('replaces the enrolments wholesale, including down to none', () => {
    assert.deepEqual(updateStudentSchema.parse({ enrolledExams: [] }).enrolledExams, []);
  });
});

describe('the roster reads both states', () => {
  it('carries studentType, enrolledExams and isTestBlocked on every row', () => {
    const parsed = studentSummarySchema.parse(summary);

    assert.equal(parsed.studentType, STUDENT_TYPE.OFFLINE);
    assert.deepEqual(parsed.enrolledExams, ['SSC CGL']);
    assert.equal(parsed.isTestBlocked, false);
  });

  /** Absent is "don't care"; false is a question the Status filter is allowed to ask. */
  it('tells an absent test-block filter apart from a false one', () => {
    assert.equal(studentListQuerySchema.parse({}).isTestBlocked, undefined);
    assert.equal(studentListQuerySchema.parse({ isTestBlocked: 'false' }).isTestBlocked, false);
    assert.equal(studentListQuerySchema.parse({ isTestBlocked: 'true' }).isTestBlocked, true);
  });
});

describe('setStudentTestBlockedSchema', () => {
  it('is its own route and its own body, separate from sign-in', () => {
    assert.equal(
      ADMIN_STUDENT_ROUTES.setTestBlocked('stu_1'),
      '/admin/students/stu_1/test-blocked',
    );
    assert.notEqual(
      ADMIN_STUDENT_ROUTES.setTestBlocked('stu_1'),
      ADMIN_STUDENT_ROUTES.setActive('stu_1'),
    );
    assert.equal(setStudentTestBlockedSchema.parse({ isTestBlocked: true }).isTestBlocked, true);
    assert.equal(setStudentTestBlockedSchema.safeParse({}).success, false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/packages/contracts && pnpm exec node --import tsx --test test/students.test.ts
```

Expect every `describe` to fail at import time:
`SyntaxError: The requested module '../src/students' does not provide an export named 'PROGRAM_MAX'`.

- [ ] **Step 3: Implement**

In `packages/contracts/src/students.ts`, add `PROGRAM_MAX` beside `PROFILE_LIST_MAX` and extend the four schemas:

```ts
/** The course they are on — free text on the row, never queried, so it is capped and left alone. */
export const PROGRAM_MAX = 120;
export const programSchema = z.string().trim().max(PROGRAM_MAX);

/** The same values as a list, for building a picker without restating them — as `GENDERS` does. */
export const STUDENT_TYPES = studentTypeSchema.options;
```

```ts
export const studentSummarySchema = z.object({
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  studentType: studentTypeSchema,
  /** ExamType codes. An EXAM or PROGRAM group is reached by matching one, with no membership row. */
  enrolledExams: z.array(z.string()),
  isActive: z.boolean(),
  /** Signs in and sees their history, but cannot start a test. Not a sign-in state. */
  isTestBlocked: z.boolean(),
  /** Whether a PIN has ever been set — an admin-created student exists but has never signed in. */
  hasSignedIn: z.boolean(),
  /** Still on an import's default PIN, which anyone holding the roster can guess. */
  hasDefaultPin: z.boolean(),
  preTestReady: z.boolean(),
  profileCompleted: z.boolean(),
  groups: z.array(groupRefSchema),
  createdAt: z.string(),
});
```

```ts
export const studentDetailSchema = studentSummarySchema.extend({
  preferredLanguage: z.string(),
  program: z.string().nullable(),
  currentBranchId: z.string().nullable(),
  updatedAt: z.string(),
  profile: studentProfileSchema.nullable(),
});
```

```ts
export const createStudentSchema = z.object({
  mobile: mobileSchema,
  // An empty box means "not known yet". `.min(1).optional()` rejects '', which blocks submit.
  fullName: blankIsAbsent(personNameSchema),
  studentType: studentTypeSchema,
  enrolledExams: z.array(z.string()).optional(),
  program: blankIsAbsent(programSchema),
  currentBranchId: blankIsAbsent(z.string().min(1)),
  groupIds: z.array(z.string()).optional(),
});
```

```ts
export const updateStudentSchema = z.object({
  // null clears the name; '' is the same intent typed differently.
  fullName: blankClears(personNameSchema),
  preferredLanguage: z.string().trim().min(2).max(8).optional(),
  studentType: studentTypeSchema.optional(),
  /** Replaces the enrolments wholesale — an empty array is a real answer. */
  enrolledExams: z.array(z.string()).optional(),
  program: blankClears(programSchema),
  currentBranchId: blankClears(z.string().min(1)),
  /** Replaces the scholarship and non-IACE grants wholesale. */
  groupIds: z.array(z.string()).optional(),
  profile: updateStudentProfileSchema.optional(),
});
```

Add `isTestBlocked: optionalBoolean(),` to `studentListQuerySchema` directly under `isActive`, then the new body and route:

```ts
export const setStudentTestBlockedSchema = z.object({ isTestBlocked: z.boolean() });
export type SetStudentTestBlockedBody = z.infer<typeof setStudentTestBlockedSchema>;
```

```ts
export const ADMIN_STUDENT_ROUTES = {
  list: '/admin/students',
  create: '/admin/students',
  detail: (id: string) => `/admin/students/${id}`,
  update: (id: string) => `/admin/students/${id}`,
  setActive: (id: string) => `/admin/students/${id}/active`,
  setTestBlocked: (id: string) => `/admin/students/${id}/test-blocked`,
} as const;
```

In `packages/contracts/src/client.ts`, add `type SetStudentTestBlockedBody` to the `./students` import block and the method after `setActive`:

```ts
        setTestBlocked: (id: string, input: SetStudentTestBlockedBody): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.setTestBlocked(id), {
            method: 'PATCH',
            body: input,
            schema: studentDetailSchema,
          }),
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/packages/contracts && pnpm exec node --import tsx --test test/students.test.ts && pnpm typecheck
```

All 10 tests pass. `pnpm typecheck` in `packages/contracts` is green; the apps are red until Task 45 and that is expected.

---

### Task 41: StudentsService writes the access fields, and test-blocking gets its own endpoint

**Files:**

- Modify: `apps/api/src/students/students.service.ts` (`create` at :158-186, `update` at :188-243, `setActive` at :274-280, `toSummary` at :313-347)
- Modify: `apps/api/src/students/students.controller.ts` (`setActive` at :60-67)
- Modify: `apps/api/src/students/students.module.ts`
- Modify: `apps/api/test/support/fakes.ts` (`FakeStudent` at :254-271, `makeStudent` at :294-314)
- Modify (the third constructor argument at EVERY site that builds a `StudentsService` — these are all of them): `apps/api/test/module-facades.unit.test.ts:100` and the block commit 1 added, `apps/api/test/group-membership.unit.test.ts:26-35`, `apps/api/test/exam-types-service.unit.test.ts` (`serviceWith`)
- Modify: `apps/api/test/students.unit.test.ts` (the `detail` fixture at :97-110 — see Task 40)
- Test: Create `apps/api/test/students-service.unit.test.ts`

**Interfaces:**

- Consumes: `ExamTypesService.assertUsable(codes: string[], fieldKey: string): Promise<void>` (from `apps/api/src/configs`, commit 1), `ConfigsModule` (commit 1), `RequiresSuperAdmin()` from `../common/security`
- Produces: `StudentsService.setTestBlocked(id: string, isTestBlocked: boolean): Promise<StudentDetail>`; `StudentsController.setTestBlocked` on `PATCH admin/students/:id/test-blocked`; `StudentsService` constructor gains a third parameter `examTypes: ExamTypesService`; `BranchesService.assertUsable(branchId: string, fieldKey = 'branchId')`

`currentBranchId` needs validating and `BranchesService.assertUsable` hardcodes `fieldErrors.branchId`
(`apps/api/src/branches/branches.service.ts:42`), which `applyFieldErrors` drops on a form whose field is
`currentBranchId` — the exact problem `ExamTypesService.assertUsable` takes a `fieldKey` to avoid. Give
branches the same parameter, defaulted so its two existing callers are untouched:

```ts
  async assertUsable(branchId: string, fieldKey = 'branchId'): Promise<void> {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such branch', {
        fieldErrors: { [fieldKey]: ['Pick a branch'] },
      });
    }
    if (!branch.isActive) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_BRANCH_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_BRANCH_MESSAGE] },
      });
    }
  }
```

then call `await this.branches.assertUsable(input.currentBranchId, 'currentBranchId')` from
`StudentsService.create`/`update` whenever the field is present and not null. `StudentsModule` imports
`BranchesModule` (which already exports the service) for it.

- Note: `StudentsService.countEnrolledIn(code)` already landed in commit 1 as the facade `ConfigsModule` consumes — this task does not add it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/students-service.unit.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, STUDENT_TYPE } from '@iace/contracts';
import { StudentsService } from '../src/students/students.service';
import { type ExamTypesService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { FakePrisma, makeStudent } from './support/fakes';

/**
 * `enrolledExams` is free text with no foreign key, so nothing but this service stops a typo
 * becoming an enrolment that resolves to no group at all. Its refusal is asserted here.
 */
class FakeExamTypes {
  readonly calls: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly usable: string[] = []) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.calls.push({ codes, fieldKey });
    const unknown = codes.filter((code) => !this.usable.includes(code));
    if (unknown.length > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam type', {
        fieldErrors: { [fieldKey]: ['No such exam type'] },
      });
    }
    return Promise.resolve();
  }

  asService(): ExamTypesService {
    return this as unknown as ExamTypesService;
  }
}

function serviceWith(students = [makeStudent()], usableExams = ['SSC CGL', 'RRB JE']) {
  const prisma = new FakePrisma(students);
  const examTypes = new FakeExamTypes(usableExams);
  return {
    prisma,
    examTypes,
    service: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
      examTypes.asService(),
    ),
  };
}

describe('StudentsService.create — the type is the caller’s, never the service’s', () => {
  it('stores the type the request asked for', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({ mobile: '9000000001', studentType: STUDENT_TYPE.OFFLINE });

    assert.equal(prisma.students[0]?.studentType, STUDENT_TYPE.OFFLINE);
  });

  it('stores the enrolments, the programme and the branch', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({
      mobile: '9000000002',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL'],
      program: 'One year classroom',
      currentBranchId: 'br_1',
    });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.equal(prisma.students[0]?.program, 'One year classroom');
    assert.equal(prisma.students[0]?.currentBranchId, 'br_1');
  });

  /**
   * The failure this exists to prevent: an exam code nothing in the catalog matches is stored, the
   * student resolves to no EXAM group, and the screen reports a successful enrolment.
   */
  it('refuses an exam code the catalog does not hold, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([]);

    const error = await service
      .create({
        mobile: '9000000003',
        studentType: STUDENT_TYPE.ONLINE,
        enrolledExams: ['SSC CGI'],
      })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams, 'the key must be the one the student form owns');
    assert.equal(prisma.students.length, 0, 'nothing was written');
  });
});

describe('StudentsService.update — the access fields', () => {
  it('replaces the enrolments and validates them first', async () => {
    const { service, prisma, examTypes } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['RRB JE'] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['RRB JE']);
    assert.deepEqual(examTypes.calls.at(-1), { codes: ['RRB JE'], fieldKey: 'enrolledExams' });
  });

  it('lets every enrolment be taken away', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: [] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, []);
  });

  it('clears the programme and the branch when the patch says null', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', program: 'One year classroom', currentBranchId: 'br_1' }),
    ]);

    await service.update('stu_1', { program: null, currentBranchId: null });

    assert.equal(prisma.students[0]?.program, null);
    assert.equal(prisma.students[0]?.currentBranchId, null);
  });

  it('leaves the access fields alone when the patch omits them', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'], program: 'One year classroom' }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.equal(prisma.students[0]?.program, 'One year classroom');
  });
});

describe('StudentsService.setTestBlocked — separate from sign-in', () => {
  it('blocks tests without touching whether they can sign in', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1' })]);

    const detail = await service.setTestBlocked('stu_1', true);

    assert.equal(detail.isTestBlocked, true);
    assert.equal(prisma.students[0]?.isTestBlocked, true);
    assert.equal(prisma.students[0]?.isActive, true, 'sign-in is a different switch');
  });

  it('lifts the block again', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1', isTestBlocked: true })]);

    await service.setTestBlocked('stu_1', false);

    assert.equal(prisma.students[0]?.isTestBlocked, false);
  });

  it('refuses a student that does not exist', async () => {
    const { service } = serviceWith([]);

    const error = await service.setTestBlocked('stu_missing', true).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json pnpm exec node --import tsx --test test/students-service.unit.test.ts
```

Fails at import: `SyntaxError: The requested module '../src/configs' does not provide an export named 'ExamTypesService'` is already satisfied by commit 1, so the real failure is
`TypeError: service.setTestBlocked is not a function` plus
`AssertionError: expected 'ONLINE' to equal 'OFFLINE'` on the first create case.

- [ ] **Step 3: Implement**

`apps/api/test/support/fakes.ts` — the four columns the summary now reads, on `FakeStudent` and `makeStudent`:

```ts
export interface FakeStudent {
  id: string;
  mobile: string;
  pinHash: string | null;
  fullName: string | null;
  studentType: StudentType;
  enrolledExams: string[];
  program: string | null;
  currentBranchId: string | null;
  preferredLanguage: string;
  preTestReady: boolean;
  profileCompleted: boolean;
  isActive: boolean;
  isTestBlocked: boolean;
  /** True while the student is still on the PIN the institute set for them. */
  pinIsDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: FakeProfile | null;
  /** The groups granted to this student — the column, as Prisma stores it. */
  directGroupIds: string[];
  deletedAt: Date | null;
}
```

`deletedAt` is not new here — commit 2 added it for the GLOBAL group's "count the whole live roster"
case. Retyping the interface without it would delete that column and break
`counts the all-students group as the whole live roster`.

with `studentType: STUDENT_TYPE.ONLINE, enrolledExams: [], program: null, currentBranchId: null,` added to the `makeStudent` defaults and `STUDENT_TYPE, type StudentType` added to the `@iace/contracts` import at the top of the file.

`apps/api/src/students/students.service.ts` — inject the catalog, drop the hardcode, write the fields:

```ts
import { Inject, Injectable, forwardRef } from '@nestjs/common';
```

```ts
/** The `fieldErrors` key the student forms own — `applyFieldErrors` drops any other. */
const ENROLLED_EXAMS_FIELD = 'enrolledExams';

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => ExamTypesService))
    private readonly examTypes: ExamTypesService,
  ) {}
```

In `create`, after `assertGroupsExist`:

```ts
if (input.enrolledExams?.length) {
  await this.examTypes.assertUsable(input.enrolledExams, ENROLLED_EXAMS_FIELD);
}

const student = await this.prisma.student.create({
  data: {
    mobile: input.mobile,
    fullName: input.fullName ?? null,
    studentType: input.studentType,
    enrolledExams: input.enrolledExams ?? [],
    program: input.program ?? null,
    currentBranchId: input.currentBranchId ?? null,
    createdVia: IMPORT_SOURCE.INDIVIDUAL,
    directGroupIds: input.groupIds ?? [],
  },
});
```

Delete the now-unused `STUDENT_TYPE` import from the `@iace/contracts` block and add `import { ExamTypesService } from '../configs';`.

In `update`, alongside the existing `groupIds` handling:

```ts
if (input.enrolledExams?.length) {
  await this.examTypes.assertUsable(input.enrolledExams, ENROLLED_EXAMS_FIELD);
}
```

and in the `data` object, beside the other patch spreads:

```ts
        ...(input.studentType === undefined ? {} : { studentType: input.studentType }),
        ...(input.enrolledExams ? { enrolledExams: input.enrolledExams } : {}),
        ...(input.program === undefined ? {} : { program: input.program }),
        ...(input.currentBranchId === undefined ? {} : { currentBranchId: input.currentBranchId }),
```

Add `setTestBlocked` beside `setActive`:

```ts
  /** Sign-in is untouched: they keep their history and their session, and cannot start a test. */
  async setTestBlocked(id: string, isTestBlocked: boolean): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({ where: { id }, select: { id: true } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.prisma.student.update({ where: { id }, data: { isTestBlocked } });
    return this.detail(id);
  }
```

Widen `toSummary`'s row type with `studentType: StudentType; enrolledExams: string[]; isTestBlocked: boolean;` and return them, and add `program: student.program, currentBranchId: student.currentBranchId,` to the object `detail` builds.

`apps/api/src/students/students.controller.ts` — `setActive` becomes super-admin-only and the new route lands beside it:

```ts
  @RequiresSuperAdmin()
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentActiveSchema)) body: SetStudentActiveBody,
  ): Promise<StudentDetail> {
    return this.students.setActive(id, body.isActive);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/test-blocked')
  setTestBlocked(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentTestBlockedSchema)) body: SetStudentTestBlockedBody,
  ): Promise<StudentDetail> {
    return this.students.setTestBlocked(id, body.isTestBlocked);
  }
```

with `RequiresSuperAdmin` added to the `../common/security` import and `setStudentTestBlockedSchema, type SetStudentTestBlockedBody` to the contracts import.

`apps/api/src/students/students.module.ts`:

```ts
@Module({
  // Identity documents are stored as keys; every read signs them. ConfigsModule is a cycle:
  // enrolments validate against the exam-type catalog, whose usage counts come back through here.
  imports: [PrismaModule, StorageModule, forwardRef(() => ConfigsModule)],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
```

Then fix the two positional constructions the third parameter breaks —
`apps/api/test/module-facades.unit.test.ts:100` becomes
`return { service: new StudentsService(prisma.asService(), null as never, null as never), student };`
and `apps/api/test/group-membership.unit.test.ts:30-33` becomes:

```ts
    studentsService: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
      undefined as unknown as ExamTypesService,
    ),
```

with `import { type ExamTypesService } from '../src/configs';` added there. Neither path calls the catalog, so neither is built.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && pnpm test
```

`students-service.unit.test.ts` passes all 10; `module-facades` and `students.unit.test.ts` stay green. `group-membership.unit.test.ts` still passes because `deactivated()` still sets `isActive: false` — Task 42 is what moves it.

---

### Task 42: The four grant paths flip from `isActive` to `isTestBlocked`, in one commit

**Files:**

- Modify: `apps/api/src/students/students.service.ts` (`assertMayJoinGroups` at :283-299)
- Modify: `apps/api/src/groups/groups.service.ts` (the `select` at :150 and the filter at :170-171)
- Modify: `apps/api/src/imports/group-member-import.ts` (:17 `GroupMemberContext`, :118 the row check)
- Modify: `apps/api/src/imports/student-import.ts` (:50 `ImportContext`, :250 the row check)
- Modify: `apps/api/src/imports/imports.service.ts` (:177, :195, :214, :226 — the selects that build both contexts)
- Modify: `packages/contracts/src/groups.ts` (`DEACTIVATED_MEMBER_MESSAGE` and `deactivatedMemberBlocker` — the wording only)
- Test: `apps/api/test/group-membership.unit.test.ts`

**Interfaces:**

- Consumes: `deactivatedMemberBlocker(count: number): string | null` — still the one place the refusal is worded, but the sentence changes with the flag it now reports:

```ts
export const DEACTIVATED_MEMBER_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a group.';

export function deactivatedMemberBlocker(blockedCount: number): string | null {
  if (blockedCount < 1) return null;
  if (blockedCount === 1) return DEACTIVATED_MEMBER_MESSAGE;
  return `${blockedCount} of those students are blocked from tests. Lift the block before granting them a group.`;
}
```

The name stays — renaming it would collide with commit 2's work on the same four call sites — but the
old sentence ("That student is deactivated. Reactivate them…") describes a state this no longer reads.
`group-membership.unit.test.ts` asserts `/deactivated/i`; that assertion becomes `/blocked from tests/i`
in Step 1.

- Produces: `GroupMemberContext.studentsByMobile` value type becomes `{ id: string; fullName: string | null; isTestBlocked: boolean }`; `ImportContext.existingByMobile` value type becomes `{ id: string; fullName: string | null; hasPin: boolean; isTestBlocked: boolean }`

- [ ] **Step 1: Write the failing test**

Rewrite the fixtures and add the discriminating case in `apps/api/test/group-membership.unit.test.ts`. Replace lines 37-39:

```ts
const active = (over = {}) => makeStudent({ id: 'stu_active', mobile: '9876543210', ...over });
/**
 * ONLY `isTestBlocked`. `isActive` deliberately stays true: with both set, this file would pass
 * against a half-flipped codebase, which is the exact thing it was written to catch.
 */
const deactivated = (over = {}) =>
  makeStudent({ id: 'stu_off', mobile: '9000000000', isTestBlocked: true, ...over });
```

and add this case to the end of the `GroupsService.addMembers` describe block:

```ts
/**
 * Sign-in and test access are separate switches. Somebody whose sign-in is suspended still
 * belongs to their course, and an admin arranging next term's groups must not be stopped.
 */
it('adds a student whose sign-in is suspended but whose tests are not blocked', async () => {
  const { groups, prisma } = servicesWith([
    makeStudent({ id: 'stu_nosignin', mobile: '9111111111', isActive: false }),
  ]);

  const result = await groups.addMembers(MORNING, ['stu_nosignin']);

  assert.equal(result.added, 1);
  assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
});
```

and the mirror of it to the end of the `StudentsService.update` describe block:

```ts
it('lets a student whose sign-in is suspended join a group', async () => {
  const { studentsService, prisma } = servicesWith([
    makeStudent({ id: 'stu_nosignin', mobile: '9111111111', isActive: false }),
  ]);

  await studentsService.update('stu_nosignin', { groupIds: [MORNING] });

  assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json pnpm exec node --import tsx --test test/group-membership.unit.test.ts
```

Seven failures, in both directions:
`AssertionError [ERR_ASSERTION]: expected error to be an instance of AppException` on every `refuses…` case (the block is no longer read), and
`AssertionError: Expected values to be strictly deep-equal: [] !== ['grp_morning']` on the two new cases (`isActive: false` still refuses).

- [ ] **Step 3: Implement**

`apps/api/src/students/students.service.ts`:

```ts
  /** Only the groups this save would ADD, so a blocked student can still lose one. */
  private assertMayJoinGroups(
    student: { isTestBlocked: boolean; directGroupIds: string[] },
    groupIds: string[],
  ): void {
    if (!student.isTestBlocked) return;
```

`apps/api/src/groups/groups.service.ts` — the `select` at :150 and the filter at :170-171:

```ts
      select: { id: true, isTestBlocked: true, directGroupIds: true },
```

```ts
// Over the ones JOINING: a blocked student already in this group gains nothing,
// and refusing them would block re-submitting a page already added.
const blocker = deactivatedMemberBlocker(
  found.filter((student) => student.isTestBlocked && joining.has(student.id)).length,
);
```

`apps/api/src/imports/group-member-import.ts`:

```ts
/** Mobile → the student it resolves to, for the numbers this file lists. */
studentsByMobile: Map<string, { id: string; fullName: string | null; isTestBlocked: boolean }>;
```

```ts
// Only when JOINING: already a member means this file grants nothing.
if (student?.isTestBlocked && !context.memberIds.has(student.id)) {
  errors.push(DEACTIVATED_MEMBER_MESSAGE);
}
```

`apps/api/src/imports/student-import.ts`:

```ts
existingByMobile: Map<
  string,
  { id: string; fullName: string | null; hasPin: boolean; isTestBlocked: boolean }
>;
```

```ts
    // Only when the row grants a group; editing a blocked student's name is fine.
    existing?.isTestBlocked && groupIds.length > 0 ? DEACTIVATED_MEMBER_MESSAGE : undefined,
```

`apps/api/src/imports/imports.service.ts` — the two selects and the two map builders:
`:177` `select: { id: true, mobile: true, fullName: true, isTestBlocked: true },`
`:195` `{ id: student.id, fullName: student.fullName, isTestBlocked: student.isTestBlocked },`
`:214` `select: { id: true, mobile: true, fullName: true, pinHash: true, isTestBlocked: true },`
`:226` `{ id: s.id, fullName: s.fullName, hasPin: s.pinHash !== null, isTestBlocked: s.isTestBlocked },`

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && pnpm test && pnpm typecheck
```

`group-membership.unit.test.ts` passes all nine. `imports.unit.test.ts` and `group-member-import.unit.test.ts` compile against the new context types — if either builds a context literal with `isActive`, rename the key there in the same pass.

---

### Task 43: The roster query learns test-blocked, and "no group" becomes "no access"

**Files:**

- Modify: `apps/api/src/students/student-query.ts` (:9-19)
- Test: `apps/api/test/student-query.unit.test.ts` (:43, :62-64, :113, :117-118, :145-157)

**Interfaces:**

- Consumes: `StudentListQuery.isTestBlocked`, `StudentListQuery.ungrouped` (Task 40)
- Produces: no new exports — `studentWhere` gains two clauses

- [ ] **Step 1: Write the failing test**

In `apps/api/test/student-query.unit.test.ts`, add `isTestBlocked` to the three-state loop at :43:

```ts
    for (const field of [
      'isActive',
      'isTestBlocked',
      'preTestReady',
      'profileCompleted',
    ] as const) {
```

replace the `ungrouped` case at :61-64:

```ts
/**
 * "Reaches no test" is enrolments AND grants, not grants alone. Reading only `directGroupIds`
 * fired on every correctly enrolled student, which made the amber badge meaningless.
 */
it('reads ungrouped as "no enrolment AND no grant", both ways round', () => {
  assertHas(
    { ungrouped: 'true' },
    { enrolledExams: { isEmpty: true }, directGroupIds: { isEmpty: true } },
  );
  assertHas(
    { ungrouped: 'false' },
    { NOT: { enrolledExams: { isEmpty: true }, directGroupIds: { isEmpty: true } } },
  );
});
```

fix the combination case at :116-119:

```ts
it('keeps the group filter alongside the ungrouped one', () => {
  const params = { groupId: 'g1', ungrouped: 'false' };

  assertHas(params, { directGroupIds: { has: 'g1' } });
  assertHas(params, {
    NOT: { enrolledExams: { isEmpty: true }, directGroupIds: { isEmpty: true } },
  });
});
```

and raise both hard-coded counts by adding the new filter to each set — :108-114:

```ts
it('keeps the group filter when a branch is chosen too', () => {
  const params = { groupId: 'g1', branchId: 'b1', isTestBlocked: 'true' };

  assertHas(params, { directGroupIds: { has: 'g1' } });
  assertHas(params, { currentBranchId: 'b1' });
  assertHas(params, { isTestBlocked: true });
  assert.equal(conditionsFor(params).length, 3);
});
```

and :145-157:

```ts
it('applies every filter at once rather than the last one set', () => {
  const conditions = conditionsFor({
    q: '98765',
    groupId: 'g1',
    branchId: 'b1',
    isActive: 'true',
    isTestBlocked: 'false',
    preTestReady: 'false',
    neverSignedIn: 'true',
    joinedFrom: '2026-01-01',
  });

  assert.equal(conditions.length, 8, 'every filter must survive');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && TSX_TSCONFIG_PATH=test/tsconfig.json pnpm exec node --import tsx --test test/student-query.unit.test.ts
```

Four failures:
`AssertionError: expected {"isTestBlocked":false} among []`,
`AssertionError: expected {"enrolledExams":{"isEmpty":true},"directGroupIds":{"isEmpty":true}} among [{"directGroupIds":{"isEmpty":true}}]`,
`AssertionError: 2 !== 3`, and
`AssertionError: 7 !== 8 — every filter must survive`.

- [ ] **Step 3: Implement**

In `apps/api/src/students/student-query.ts`, add the flag beside `isActive` and rewrite the `ungrouped` clause:

```ts
if (query.isActive !== undefined) add({ isActive: query.isActive });
if (query.isTestBlocked !== undefined) add({ isTestBlocked: query.isTestBlocked });
if (query.preTestReady !== undefined) add({ preTestReady: query.preTestReady });
if (query.profileCompleted !== undefined) add({ profileCompleted: query.profileCompleted });

// A grant is an id in a column on the student, and the branch is another one:
// neither is a join any more.
if (query.groupId) add({ directGroupIds: { has: query.groupId } });
if (query.branchId) add({ currentBranchId: query.branchId });
if (query.ungrouped !== undefined) {
  // Reaching no test is BOTH empty: an EXAM group is reached by an enrolment, with no grant row.
  const reachesNothing = {
    enrolledExams: { isEmpty: true },
    directGroupIds: { isEmpty: true },
  } satisfies Prisma.StudentWhereInput;
  add(query.ungrouped ? reachesNothing : { NOT: reachesNothing });
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/api && pnpm test
```

All of `student-query.unit.test.ts` passes; the whole API suite stays green.

---

### Task 44: The Access card on student detail, and the two switches beside it

**Files:**

- Modify: `apps/admin/src/lib/constants.ts` (append)
- Modify: `apps/admin/src/routes/student-detail.tsx` (`FormValues` :30-39, `FORM_FIELDS` :41-50, `toFormValues` :55-66, `GroupsCard` :91-134, `defaultValues` :147-158, mutation body :168-183, `setActive` :202-213, header action :245-258, `ConfirmDialog` :260-279, badges :281-296, form grid :384-391)
- Modify: `apps/admin/src/components/group-picker.tsx` (the query at :43-47, the empty state at :148-156) — see Step 4
- Test: `packages/ui/test/confirm-destructive.test.ts` (:10-17, :42-60)

**Interfaces:**

- Consumes: `MultiCombobox` from `@iace/ui` (commit 1), `useExamTypes({ activeOnly: true })` from `../lib/use-exam-types` (commit 1), `useBranches({ activeOnly: true })`, `api.admin.students.setTestBlocked`, `useAuth().identity.isSuperAdmin`, `PROGRAM_MAX`, `STUDENT_TYPE`
- Produces: `STUDENT_TYPE_LABELS: Readonly<Record<StudentType, string>>` in `apps/admin/src/lib/constants.ts`; `AccessCard` (local to `student-detail.tsx`)

- [ ] **Step 1: Write the failing test**

In `packages/ui/test/confirm-destructive.test.ts`, extend `NEEDS_CONFIRMING` at :10-17:

```ts
const NEEDS_CONFIRMING = [
  /api\.admin\.\w+\.remove\(/,
  /api\.admin\.\w+\.setActive\(/,
  /api\.admin\.\w+\.setTestBlocked\(/,
  /api\.admin\.\w+\.addMembers\(/,
  /api\.admin\.\w+\.removeMember\(/,
  /api\.admin\.admins\.create\(/,
  /api\.admin\.sync\./,
  /api\.admin\.features\.revoke\(/,
  /api\.admin\.features\.grant\(/,
] as const;
```

and rewrite the toggle case at :42-60 — the reverse label the student screen must carry is now the test one, and the click assertion stops naming a single mutation:

```ts
it('ask in both directions of a toggle', () => {
  const toggles = {
    'apps/admin/src/routes/admins.tsx': 'Reactivate',
    'apps/admin/src/routes/student-detail.tsx': 'Allow tests',
    'apps/admin/src/routes/branches.tsx': 'Reactivate branch',
    'apps/admin/src/routes/exam-types.tsx': 'Reactivate exam type',
    'apps/admin/src/routes/groups.tsx': 'Reactivate group',
  };

  for (const [relative, label] of Object.entries(toggles)) {
    const source = readFileSync(path.join(REPO_ROOT, relative), 'utf8');
    assert.ok(
      source.includes(`'${label}'`),
      `${relative}: the reverse direction must reach a ConfirmDialog too`,
    );
    // Keyed to the shape, not to one mutation's name — the identifier gets renamed.
    assert.ok(
      !/onClick=\{\(\) => \w+\.mutate\(/.test(source),
      `${relative}: a toggle must not fire straight from a click`,
    );
  }
});

/** Sign-in and test access are separate switches, and each asks on its own terms. */
it('ask separately about sign-in and about sitting tests', () => {
  const detail = readFileSync(
    path.join(REPO_ROOT, 'apps/admin/src/routes/student-detail.tsx'),
    'utf8',
  );

  assert.ok(
    detail.includes("'Block from tests'"),
    'blocking tests must go through a ConfirmDialog',
  );
  assert.ok(
    detail.includes("'Suspend sign-in'"),
    'suspending sign-in must go through a ConfirmDialog',
  );
  assert.ok(detail.includes("'Restore sign-in'"), 'the reverse of sign-in must ask too');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/harshithdiyyala/Projects/iace/packages/ui && TSX_TSCONFIG_PATH=test/tsconfig.json pnpm exec node --import tsx --import ./test/support/dom.ts --test test/confirm-destructive.test.ts
```

Two failures:
`AssertionError: apps/admin/src/routes/student-detail.tsx: the reverse direction must reach a ConfirmDialog too` and
`AssertionError: blocking tests must go through a ConfirmDialog`.

- [ ] **Step 3: Implement**

Append to `apps/admin/src/lib/constants.ts` (`type StudentType` and `STUDENT_TYPE` come from `@iace/contracts`):

```ts
/** What each student type is called on screen. The enum values are never shown raw. */
export const STUDENT_TYPE_LABELS: Readonly<Record<StudentType, string>> = {
  [STUDENT_TYPE.ONLINE]: 'Online',
  [STUDENT_TYPE.OFFLINE]: 'At a branch',
  [STUDENT_TYPE.NON_IACE]: 'Not an IACE student',
};
```

In `apps/admin/src/routes/student-detail.tsx`, thread the four fields through all five places the form contract lives:

```ts
interface FormValues {
  fullName: string;
  studentType: StudentType;
  enrolledExams: string[];
  program: string;
  currentBranchId: string;
  motherName: string;
  fatherName: string;
  dob: string;
  email: string;
  address: string;
  gender: '' | Gender;
  groupIds: string[];
}

const FORM_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'program',
  'currentBranchId',
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
  'groupIds',
] as const;
```

```ts
function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    studentType: student.studentType,
    enrolledExams: [...student.enrolledExams],
    program: student.program ?? '',
    currentBranchId: student.currentBranchId ?? '',
    motherName: student.profile?.motherName ?? '',
    fatherName: student.profile?.fatherName ?? '',
    dob: student.profile?.dob ?? '',
    email: student.profile?.email ?? '',
    address: student.profile?.address ?? '',
    gender: student.profile?.gender ?? '',
    groupIds: student.groups.map((group) => group.id),
  };
}
```

`defaultValues` gains `studentType: STUDENT_TYPE.ONLINE, enrolledExams: [], program: '', currentBranchId: '',`, and the mutation body gains them with the enrolments carrying their own dirty guard:

```ts
    mutationFn: (values: FormValues) =>
      api.admin.students.update(id, {
        fullName: orNull(values.fullName),
        studentType: values.studentType,
        program: orNull(values.program),
        currentBranchId: orNull(values.currentBranchId),
        // An omitted key means "leave it alone", which is true of a list nobody touched.
        ...(form.formState.dirtyFields.enrolledExams
          ? { enrolledExams: values.enrolledExams }
          : {}),
        ...(form.formState.dirtyFields.groupIds ? { groupIds: values.groupIds } : {}),
        profile: {
          motherName: orNull(values.motherName),
          fatherName: orNull(values.fatherName),
          dob: orNull(values.dob),
          email: orNull(values.email),
          address: orNull(values.address),
          gender: values.gender === '' ? null : values.gender,
        },
      }),
```

Add the card itself, above `StudentDetailPage`:

```tsx
/** Where a student sits relative to the institute — the four fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  const examTypes = useExamTypes({ activeOnly: true });
  const branches = useBranches({ activeOnly: true });
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
        <CardDescription>
          Enrolments are how a student reaches an exam or programme group — no membership is added
          for them. Scholarship and non-IACE groups are granted below instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          htmlFor="studentType"
          label="Student type"
          error={form.formState.errors.studentType?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('studentType')}>
              {STUDENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {STUDENT_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          htmlFor="enrolledExams"
          label="Enrolled exams"
          hint="Every exam or programme group under these is reachable."
          error={form.formState.errors.enrolledExams?.message}
        >
          {(control) => (
            <MultiCombobox
              {...control}
              value={enrolledExams}
              onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
              items={examTypes.map((examType) => ({
                value: examType.code,
                label: examType.code,
                hint: examType.name,
              }))}
              placeholder="No exams yet"
              emptyLabel="No exam type matches that"
            />
          )}
        </Field>

        <Field htmlFor="program" label="Programme" error={form.formState.errors.program?.message}>
          {(control) => (
            <Input {...control} maxLength={PROGRAM_MAX} {...form.register('program')} />
          )}
        </Field>

        <Field
          htmlFor="currentBranchId"
          label="Current branch"
          hint="The centre they attend now — what scheduling reads."
          error={form.formState.errors.currentBranchId?.message}
        >
          {(control) => (
            <Combobox
              {...control}
              value={currentBranchId}
              onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
              items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              placeholder="Not recorded"
              emptyLabel="No branch matches that"
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
```

Reword `GroupsCard` — it now describes grants, and its lock reads the right flag:

```tsx
/** A blocked student may lose a grant but not gain one, so the unticked boxes lock. */
function GroupsCard({
  isTestBlocked,
  known,
  selectedIds,
  register,
  error,
}: Readonly<{
  isTestBlocked: boolean;
  known: GroupRef[];
  selectedIds: string[];
  register: UseFormRegisterReturn;
  error?: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group grants</CardTitle>
        <CardDescription>
          Scholarship and non-IACE groups, given student by student. Exam and programme groups are
          not here — they follow the enrolments above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isTestBlocked ? (
          <Alert variant="info">
            <span>
              Blocked from tests, so no new group can be granted. Their current grants can still be
              taken away, or lift the block first.
            </span>
          </Alert>
        ) : null}

        <GroupPicker
          idPrefix="group"
          register={register}
          selectedIds={selectedIds}
          known={known}
          error={error}
          lockedToSelection={isTestBlocked}
        />
      </CardContent>
    </Card>
  );
}
```

The `CardDescription` above is the wording commit 2 put there when it deleted the false "must stay in
at least one group" sentence. This task supersedes it with the version shown; do not leave both.

- [ ] **Step 4: Narrow the picker to the groups a grant is even possible on**

`apps/admin/src/components/group-picker.tsx`. Every group it offers today is grantable in its own eyes,
but an EXAM or PROGRAM group is reached by enrolment — ticking one would produce a
`DIRECT_GRANT_MESSAGE` refusal from the server that the admin could not have predicted. The query at
`:43-47` gains the filter Task 21 added:

```tsx
const groups = useQuery({
  queryKey: ['admin', 'groups', 'picker', search],
  queryFn: () =>
    api.admin.groups.list({ q: search, pageSize: PAGE_SIZE_MAX, acceptsGrants: 'true' }),
  placeholderData: keepPreviousData,
});
```

and the empty state at `:148-156`, which now means something narrower than it says, becomes:

```tsx
<Alert variant="warning">
  <span>
    No scholarship or non-IACE group exists yet — those are the only ones granted student by
    student.{' '}
    <Link to={ROUTES.GROUPS} className={linkVariants({ variant: 'inline' })}>
      Create a group
    </Link>
    .
  </span>
</Alert>
```

- [ ] **Step 5: The two switches beside the card**

Replace the single mutation and dialog with two of each. State becomes `const [blockConfirm, setBlockConfirm] = useState(false); const [signInConfirm, setSignInConfirm] = useState(false);`, and:

```ts
const setTestBlocked = useMutation({
  meta: {
    success: (): string => (detail?.isTestBlocked ? 'Tests allowed again.' : 'Blocked from tests.'),
  },
  mutationFn: (isTestBlocked: boolean) => api.admin.students.setTestBlocked(id, { isTestBlocked }),
  onError: () => setBlockConfirm(false),
  onSuccess: (updated) => {
    setBlockConfirm(false);
    queryClient.setQueryData(['admin', 'student', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
  },
});

const setActive = useMutation({
  meta: {
    success: (): string => (detail?.isActive ? 'Sign-in suspended.' : 'Sign-in restored.'),
  },
  mutationFn: (isActive: boolean) => api.admin.students.setActive(id, isActive),
  onError: () => setSignInConfirm(false),
  onSuccess: (updated) => {
    setSignInConfirm(false);
    queryClient.setQueryData(['admin', 'student', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
  },
});
```

The header action, with the sign-in control gated the way `branches.tsx` gates its row actions:

```tsx
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={detail.isTestBlocked ? 'secondary' : 'destructive'}
              size="sm"
              loading={setTestBlocked.isPending}
              onClick={() => setBlockConfirm(true)}
            >
              {detail.isTestBlocked ? 'Allow tests' : 'Block from tests'}
            </Button>
            {isSuperAdmin ? (
              <Button
                variant="outline"
                size="sm"
                loading={setActive.isPending}
                onClick={() => setSignInConfirm(true)}
              >
                {detail.isActive ? 'Suspend sign-in' : 'Restore sign-in'}
              </Button>
            ) : null}
          </div>
        }
```

and both dialogs, replacing the one at :260-279:

```tsx
      {/* Both directions ask, so a control that changes whether somebody can sit
          an exam never acts on a single click. */}
      <ConfirmDialog
        open={blockConfirm}
        onOpenChange={setBlockConfirm}
        destructive={!detail.isTestBlocked}
        loading={setTestBlocked.isPending}
        title={
          detail.isTestBlocked
            ? `Allow ${name} to sit tests again?`
            : `Block ${name} from tests?`
        }
        description={
          detail.isTestBlocked
            ? 'They can start tests again straight away, on everything their enrolments and grants reach. Nothing was lost while it was on.'
            : 'They can still sign in and see every test they have already sat, and their results. They cannot start a new one until this is lifted. A session they already have open is not signed out.'
        }
        confirmLabel={detail.isTestBlocked ? 'Allow tests' : 'Block from tests'}
        onConfirm={() => setTestBlocked.mutate(!detail.isTestBlocked)}
      />

      <ConfirmDialog
        open={signInConfirm}
        onOpenChange={setSignInConfirm}
        destructive={detail.isActive}
        loading={setActive.isPending}
        title={detail.isActive ? `Suspend sign-in for ${name}?` : `Restore sign-in for ${name}?`}
        description={
          detail.isActive
            ? 'They cannot sign in at all, on any device. A session they already have open is not revoked — it lasts until its token expires. Their record, attempts and results are kept.'
            : 'They can sign in again. Whether they may sit a test is the other switch, and this does not change it.'
        }
        confirmLabel={detail.isActive ? 'Suspend sign-in' : 'Restore sign-in'}
        onConfirm={() => setActive.mutate(!detail.isActive)}
      />
```

with `const name = detail.fullName ?? detail.mobile;` declared next to `const detail = student.data;` and `const isSuperAdmin = useAuth().identity?.isSuperAdmin ?? false;` beside the other hooks. The badge row at :288 gains the second state:

```tsx
{
  !detail.isActive ? <Badge variant="danger">Sign-in suspended</Badge> : null;
}
{
  detail.isTestBlocked ? <Badge variant="danger">Blocked from tests</Badge> : null;
}
```

and the form grid renders the new card first in the right-hand column:

```tsx
        <div className="flex flex-col gap-5">
          <AccessCard form={form} />

          <GroupsCard
            isTestBlocked={detail.isTestBlocked}
            known={detail.groups}
            selectedIds={selectedGroupIds}
            register={form.register('groupIds')}
            error={form.formState.errors.groupIds?.message}
          />
```

Imports to add: `type UseFormReturn` from `react-hook-form`; `Combobox, MultiCombobox` from `@iace/ui`; `PROGRAM_MAX, STUDENT_TYPE, STUDENT_TYPES, type StudentType` from `@iace/contracts` (`STUDENT_TYPES` is produced by Task 40); `STUDENT_TYPE_LABELS` from `../lib/constants`; `useExamTypes` from `../lib/use-exam-types`; `useBranches` from `../lib/use-branches`; `useAuth` from `../providers/auth`.

- [ ] **Step 6: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/packages/ui && pnpm test && cd /Users/harshithdiyyala/Projects/iace/apps/admin && pnpm typecheck
```

`confirm-destructive.test.ts` passes all six cases. The admin typecheck still fails inside `students.tsx` on the missing `studentType` in the create body — Task 45.

---

### Task 45: The roster — a type on the New student card, a blocked state, and the real "no access"

**Files:**

- Modify: `apps/admin/src/routes/students.tsx` (`StatusFilter` :62, `STATUS_QUERY` :89-99, `studentColumns` :101-134, the status Select :279-291, the ungrouped Field :398-414, `SignInStatus` :477-485, `GroupsCell` :511-531, `NEW_STUDENT_FIELDS` :535, `NewStudentCard` :538-634)
- Test: none new — `packages/contracts/test/students.test.ts` already pins the create body this screen has to satisfy, and `confirm-destructive.test.ts` scans this file

**Interfaces:**

- Consumes: `createStudentSchema` (now requiring `studentType`), `StudentSummary.enrolledExams` / `.isTestBlocked` / `.studentType`, `STUDENT_TYPE_LABELS`, `STUDENT_TYPES`, `MultiCombobox`, `useExamTypes({ activeOnly: true })`
- Produces: `StatusFilter` gains `'blocked'`; `STATUS_QUERY.blocked = { isTestBlocked: 'true' }`

- [ ] **Step 1: Write the failing test**

No new test file — the contract this step has to satisfy is already asserted. Reproduce the failure directly:

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/admin && pnpm typecheck
```

- [ ] **Step 2: Run it and watch it fail**

Expected output:

```
src/routes/students.tsx:544:5 - error TS2739: Type '{ mobile: string; fullName: string; groupIds: never[]; }' is missing the following properties from type '{ mobile: string; studentType: "ONLINE" | "OFFLINE" | "NON_IACE"; ... }': studentType
src/routes/students.tsx:555:7 - error TS2345: Argument of type '{ mobile: string; fullName: string | undefined; groupIds: string[] | undefined; }' is not assignable to parameter of type 'CreateStudentInput'.
```

- [ ] **Step 3: Implement**

The status filter gains its entry — `status` already owns a key in `ALL_FILTERS`, and the query object already carries the entry through the `...STATUS_QUERY[status]` spread, so no third place changes:

```ts
type StatusFilter = 'all' | 'active' | 'inactive' | 'blocked' | 'invited' | 'defaultpin';
```

```ts
/** Each filter is one query shape; keeping them together stops them contradicting. */
const STATUS_QUERY: Record<
  StatusFilter,
  {
    isActive?: 'true' | 'false';
    isTestBlocked?: 'true';
    neverSignedIn?: 'true';
    hasDefaultPin?: 'true';
  }
> = {
  all: {},
  active: { isActive: 'true' },
  inactive: { isActive: 'false' },
  blocked: { isTestBlocked: 'true' },
  invited: { neverSignedIn: 'true' },
  defaultpin: { hasDefaultPin: 'true' },
};
```

with `<option value="blocked">Blocked from tests</option>` added after `inactive`, and `<option value="inactive">` relabelled `Sign-in suspended`.

The access column and the two badges:

```tsx
/** Reaches no test at all: no enrolment AND no grant. Either one on its own is access. */
const reachesNothing = (student: StudentSummary): boolean =>
  student.enrolledExams.length === 0 && student.groups.length === 0;

function studentColumns(): DataTableColumn<StudentSummary>[] {
  return [
    { key: 'name', header: 'Student', cell: (s) => <StudentNameCell student={s} /> },
    {
      key: 'mobile',
      header: 'Mobile',
      className: 'tabular-nums text-muted-foreground',
      cell: (s) => s.mobile,
    },
    {
      key: 'access',
      header: 'Access',
      cell: (s) =>
        reachesNothing(s) ? (
          // Neither enrolled nor granted, so they can reach no test at all.
          <Badge variant="warning">No access</Badge>
        ) : (
          <AccessCell student={s} />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1">
          <SignInStatus student={s} />
          {/* Its own badge: being unable to start a test is not a sign-in state. */}
          {s.isTestBlocked ? <Badge variant="danger">No tests</Badge> : null}
        </div>
      ),
    },
    {
      key: 'pretest',
      header: 'Pre-test details',
      cell: (s) => (
        <Badge variant={s.preTestReady ? 'success' : 'neutral'}>
          {s.preTestReady ? 'On file' : 'Needed'}
        </Badge>
      ),
    },
  ];
}
```

```tsx
/**
 * Everything a student reaches tests through, in one line: enrolments and grants together, the
 * first shown and the rest behind a count. Deduplicated, because a code and a group name can match.
 */
function AccessCell({ student }: Readonly<{ student: StudentSummary }>) {
  const labels = [...new Set([...student.enrolledExams, ...student.groups.map((g) => g.name)])];

  return (
    <BadgeList items={labels} label={(entry) => entry} className="max-w-[12rem]">
      {(entry) => (
        <Badge className="min-w-0 shrink">
          <TruncatedText>{entry}</TruncatedText>
        </Badge>
      )}
    </BadgeList>
  );
}
```

`SignInStatus` keeps reading `isActive` only, with its first line reworded:

```tsx
function SignInStatus({ student }: Readonly<{ student: StudentSummary }>) {
  if (!student.isActive) return <Badge variant="danger">Sign-in suspended</Badge>;
```

The folded filter retargets to the same condition the API now asks:

```tsx
<Field
  htmlFor="filter-ungrouped"
  label="Access"
  hint="No enrolment and no grant means they can reach no test."
>
  {(control) => (
    <Select
      {...control}
      value={filters.get('ungrouped')}
      onChange={(event) => filters.set({ ungrouped: event.target.value })}
    >
      <option value="">Any</option>
      <option value="true">Reaches nothing</option>
      <option value="false">Reaches at least one</option>
    </Select>
  )}
</Field>
```

The New student card gains the type and the enrolments:

```ts
const NEW_STUDENT_FIELDS = [
  'mobile',
  'fullName',
  'studentType',
  'enrolledExams',
  'groupIds',
] as const;
```

```tsx
const form = useForm<CreateStudentInput>({
  resolver: zodResolver(createStudentSchema),
  defaultValues: {
    mobile: '',
    fullName: '',
    studentType: STUDENT_TYPE.ONLINE,
    enrolledExams: [],
    groupIds: [],
  },
});

const selectedGroupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];
const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
const examTypes = useExamTypes({ activeOnly: true });
```

```tsx
    mutationFn: (values: CreateStudentInput) =>
      api.admin.students.create({
        mobile: values.mobile,
        // An untouched name field is "not known yet", not an empty name.
        fullName: values.fullName?.trim() ? values.fullName.trim() : undefined,
        studentType: values.studentType,
        enrolledExams: values.enrolledExams?.length ? values.enrolledExams : undefined,
        groupIds: values.groupIds?.length ? values.groupIds : undefined,
      }),
```

and the two controls, inserted between the name row and the `Groups` fieldset:

```tsx
<div className="flex flex-wrap gap-4">
  <FormField form={form} name="studentType" label="Student type" className="min-w-56 flex-1">
    {(control) => (
      <Select {...control}>
        {STUDENT_TYPES.map((value) => (
          <option key={value} value={value}>
            {STUDENT_TYPE_LABELS[value]}
          </option>
        ))}
      </Select>
    )}
  </FormField>

  <FormField
    form={form}
    name="enrolledExams"
    label="Enrolled exams"
    hint="How they reach an exam or programme group"
    className="min-w-56 flex-1"
  >
    {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
      <MultiCombobox
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={enrolledExams}
        onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
        items={examTypes.map((examType) => ({
          value: examType.code,
          label: examType.code,
          hint: examType.name,
        }))}
        placeholder="None yet"
        emptyLabel="No exam type matches that"
      />
    )}
  </FormField>
</div>
```

The `CardDescription` copy at :572-575 becomes: _"The mobile number and the student type are required. They will set their own PIN the first time they sign in, and land on this same record."_ Imports to add: `MultiCombobox` from `@iace/ui`, `STUDENT_TYPE, STUDENT_TYPES` from `@iace/contracts`, `STUDENT_TYPE_LABELS` from `../lib/constants`, `useExamTypes` from `../lib/use-exam-types`.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace/apps/admin && pnpm typecheck && pnpm lint
```

Both green.

---

### Task 46: The student portal says so, then the whole thing goes in as one commit

**Files:**

- Modify: `apps/test/src/components/app-shell.tsx` (:49, then append)
- Test: the full gate run below

**Interfaces:**

- Consumes: `StudentIdentity.isTestBlocked` (already on `studentIdentitySchema` in `packages/contracts/src/auth.ts:148`, already populated by `AuthService.studentIdentity`)
- Produces: `TestBlockedBanner` (local to `app-shell.tsx`)

- [ ] **Step 1: Write the failing test**

No test file — the banner is a rendered fact with no branch worth pinning, and the spec's testing list does not call for one. Reproduce the gap instead, which must print nothing:

```bash
cd /Users/harshithdiyyala/Projects/iace && grep -rn "isTestBlocked" apps/test/src/ || echo "MISSING: the portal never mentions the block"
```

- [ ] **Step 2: Run it and watch it fail**

Output: `MISSING: the portal never mentions the block` — a blocked student's portal is byte-identical to an unblocked one, which is exactly what the spec rejected.

- [ ] **Step 3: Implement**

In `apps/test/src/components/app-shell.tsx`, add `Alert` to the `@iace/ui` import, replace line 49, and append the banner:

```tsx
{
  student?.hasDefaultPin ? (
    <DefaultPinGate />
  ) : (
    <>
      {student?.isTestBlocked ? <TestBlockedBanner /> : null}
      <Outlet />
    </>
  );
}
```

```tsx
/**
 * A banner and not a gate: sign-in, history and results are all still theirs, and the server is
 * what refuses a new attempt. Saying nothing would leave them pressing Start and being turned away.
 */
function TestBlockedBanner() {
  return (
    <div className="mb-5">
      <Alert variant="warning">
        <span>
          Tests are on hold for you at the moment. Everything you have already sat, and your
          results, stay here. Ask at your branch office to have it lifted.
        </span>
      </Alert>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/harshithdiyyala/Projects/iace && node --version && pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Node must print `v22.x`. All six green before anything is staged.

- [ ] **Step 5: Commit**

`packages/contracts/src/questions.ts` is untracked and belongs to another piece of work; the scanner reads the working tree, so it fails the gate on `typescript:S3776`. Move it aside byte-identically, commit, put it back — the same dance as `035d7a2e`:

```bash
cd /Users/harshithdiyyala/Projects/iace && \
  cp packages/contracts/src/questions.ts /private/tmp/claude-501/-Users-harshithdiyyala-Projects-iace/3ea8439c-2bf9-4f47-a619-c4a97c1246a3/scratchpad/questions.ts.hold && \
  shasum packages/contracts/src/questions.ts && \
  rm packages/contracts/src/questions.ts && \
  git status --short
```

Stage whole files only, and confirm nothing is left half-staged:

```bash
cd /Users/harshithdiyyala/Projects/iace && git add \
  packages/contracts/src/students.ts \
  packages/contracts/src/client.ts \
  packages/contracts/test/students.test.ts \
  apps/api/src/students/students.service.ts \
  apps/api/src/students/students.controller.ts \
  apps/api/src/students/students.module.ts \
  apps/api/src/students/student-query.ts \
  apps/api/src/groups/groups.service.ts \
  apps/api/src/imports/group-member-import.ts \
  apps/api/src/imports/student-import.ts \
  apps/api/src/imports/imports.service.ts \
  apps/api/test/support/fakes.ts \
  apps/api/test/students-service.unit.test.ts \
  apps/api/test/group-membership.unit.test.ts \
  apps/api/test/student-query.unit.test.ts \
  apps/api/test/module-facades.unit.test.ts \
  apps/admin/src/lib/constants.ts \
  apps/admin/src/routes/student-detail.tsx \
  apps/admin/src/routes/students.tsx \
  apps/test/src/components/app-shell.tsx \
  packages/ui/test/confirm-destructive.test.ts && \
  git diff --stat
```

`git diff --stat` must print nothing. Then commit and let the pre-commit gate run its real SonarQube scan — no `--no-verify`, no `SKIP_SONAR=1`:

```bash
cd /Users/harshithdiyyala/Projects/iace && git commit -F - <<'MSG'
feat(students): make the access fields settable, and give the test block a switch

Every student was created ONLINE with no enrolments, because `studentType` was
hardcoded in the service and no screen offered it. Access resolves through
`enrolledExams`, so the whole roster reached nothing. The Access card writes all
four fields — type, enrolments, programme, branch — and enrolments are validated
against the exam-type catalog under the field key the student form owns, because
`applyFieldErrors` silently drops any other.

The four places enforcing "a deactivated student gains no new group" now read
`isTestBlocked`, all in this one commit: half-flipped, the rule contradicts
itself between the detail form and the two importers. `isActive` keeps its four
sign-in refusals in auth, and its only control is now a super-admin one.

The dialogs are rewritten because the old copy became false: blocking tests does
not stop a sign-in, and does not revoke a session that is already open. The
portal says so too, rather than letting a blocked student find out by pressing
Start. The amber roster badge retargets to no enrolment AND no grant, which is
the condition it always claimed to mean.
MSG
```

Restore the held file and confirm it is unchanged:

```bash
cd /Users/harshithdiyyala/Projects/iace && \
  cp /private/tmp/claude-501/-Users-harshithdiyyala-Projects-iace/3ea8439c-2bf9-4f47-a619-c4a97c1246a3/scratchpad/questions.ts.hold packages/contracts/src/questions.ts && \
  shasum packages/contracts/src/questions.ts && \
  git status --short && git log --oneline -1
```

The sha must match the one printed before the move, `git status --short` must show only `?? packages/contracts/src/questions.ts`, and the log must show the new commit on `main`.
