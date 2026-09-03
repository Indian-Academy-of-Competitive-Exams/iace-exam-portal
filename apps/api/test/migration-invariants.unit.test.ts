import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The rules the target model states that prisma/schema.prisma has no syntax for. Prisma
 * regenerates the DDL above them from the schema on demand, but everything asserted here
 * survives only because it is written into the migration by hand — and it is invisible to
 * `prisma migrate diff`, so nothing else in the toolchain notices if it goes missing.
 *
 * These tests read the SQL rather than a database: the suite runs with no infrastructure.
 */
const MIGRATION = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260820000000_schema_realignment/migration.sql'),
  'utf8',
);

const COURSE_RENAME = readFileSync(
  join(
    __dirname,
    '../../../prisma/migrations/20260903060000_an_exam_belongs_to_a_course_not_a_family/migration.sql',
  ),
  'utf8',
);

const ACCESS_CONSTRAINTS = readFileSync(
  join(
    __dirname,
    '../../../prisma/migrations/20260904110000_the_new_access_shape_holds_itself_together/migration.sql',
  ),
  'utf8',
);

const REQUIRED_ARRAYS = [
  ['BaseConfig', 'languages', '"SupportedLanguage"'],
  ['Attempt', 'languages', '"SupportedLanguage"'],
  // The name THAT migration wrote; a later one renamed it, NOT NULL and default intact.
  ['Student', 'enrolledFamilies', '"ExamFamily"'],
  ['Student', 'enrolledExams', 'TEXT'],
] as const;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('required arrays', () => {
  /** Prisma emits a scalar list as a nullable column, whatever the model says. */
  for (const [table, column, type] of REQUIRED_ARRAYS) {
    it(`${table}.${column} is NOT NULL`, () => {
      assert.match(
        MIGRATION,
        new RegExp(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`),
      );
    });

    /**
     * The failure this prevents: Prisma omits an unset list from the INSERT rather than
     * sending an empty array, so NOT NULL with no default breaks every create that does
     * not name the column — and Student's only mandatory field is its mobile number. This
     * half comes from `@default([])` in the schema and is regenerated with the DDL, which
     * is exactly why it is the half worth pinning.
     */
    it(`${table}.${column} defaults to an empty array, so a create may omit it`, () => {
      const sqlType = escapeForRegex(type);
      assert.match(
        MIGRATION,
        new RegExp(`"${column}" ${sqlType}\\[\\] DEFAULT ARRAY\\[\\]::${sqlType}\\[\\]`),
      );
    });
  }
});

describe('soft delete releases a unique slot', () => {
  /** The failure this prevents: a removed student holding a mobile number forever. */
  for (const [table, column] of [
    ['Student', 'mobile'],
    ['Student', 'externalRef'],
    ['Branch', 'name'],
  ]) {
    it(`${table}.${column} is unique only among rows that are not deleted`, () => {
      assert.match(
        MIGRATION,
        new RegExp(
          `CREATE UNIQUE INDEX "\\w+" ON "${table}"\\("${column}"\\) WHERE "deletedAt" IS NULL`,
        ),
      );
    });
  }
});

describe('conditional uniqueness a plain unique cannot state', () => {
  /** One ranked attempt per test, any number of practice retakes alongside it. */
  it('allows a single graded attempt per (test, student)', () => {
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "\w+" ON "Attempt"\("testId", "studentId"\) WHERE "isGraded"/,
    );
  });

  it('allows a single open unlock request per (student, series)', () => {
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "\w+" ON "SeriesUnlockRequest"\("studentId", "testSeriesId"\) WHERE "status" = 'PENDING'/,
    );
  });

  it('allows a single default config per stage', () => {
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "\w+" ON "BaseConfig"\("examStageId"\) WHERE "isDefault"/,
    );
  });

  /**
   * The failure this prevents: nulls are distinct, so the composite unique on
   * (baseConfigId, moduleId, order) lets two module-less sections share an order.
   */
  it("keeps a flat config's section order unique", () => {
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "\w+" ON "BaseConfigSection"\("baseConfigId", "order"\) WHERE "moduleId" IS NULL/,
    );
  });
});

describe('the outbox poll', () => {
  /** Pending rows are a shrinking tail of a table that only grows. */
  it('is served by an index over pending rows alone', () => {
    assert.match(
      MIGRATION,
      /CREATE INDEX "\w+" ON "OutboxEvent"\("createdAt"\) WHERE "processedAt" IS NULL/,
    );
  });
});

describe('a ranked test', () => {
  /** The failure this prevents: a leaderboard ranking students who sat different papers. */
  it('cannot be scored from a per-attempt paper', () => {
    assert.match(MIGRATION, /CHECK \("evaluationMode" <> 'RANKED' OR "paperBinding" = 'FIXED'\)/);
  });
});

describe('section shape follows the config timer template', () => {
  for (const [template, column] of [
    ['SESSION_MODULE_LOCKED', 'module_id'],
    ['SECTIONAL_LOCKED', 'duration_sec'],
    ['PER_ITEM_TIMED', 'per_question_sec'],
  ]) {
    it(`requires ${column} when the config is ${template}`, () => {
      assert.match(MIGRATION, new RegExp(`template = '${template}' AND ${column} IS NULL`));
    });
  }

  it('refuses a module on a section of a config that has none', () => {
    assert.match(MIGRATION, /template <> 'SESSION_MODULE_LOCKED' AND module_id IS NOT NULL/);
  });

  /** The rules break from either end, so both ends are watched. */
  for (const [trigger, event, table] of [
    ['base_config_section_shape_guard', 'AFTER INSERT OR UPDATE', 'BaseConfigSection'],
    ['base_config_shape_guard', 'AFTER UPDATE OF "timerTemplate"', 'BaseConfig'],
  ] as const) {
    it(`checks ${table} on ${event.toLowerCase()}, at commit`, () => {
      assert.match(
        MIGRATION,
        new RegExp(
          `CREATE CONSTRAINT TRIGGER ${trigger}\\s+${event} ON "${table}"\\s+DEFERRABLE INITIALLY DEFERRED`,
        ),
      );
    });
  }

  /**
   * The failure deferring prevents: a section may only carry a moduleId once its config is
   * SESSION_MODULE_LOCKED, and that config may only be SESSION_MODULE_LOCKED once its
   * sections carry one. Checked per statement, neither order succeeds.
   */
  it('re-reads the row at commit, because a later statement may have moved or removed it', () => {
    assert.match(
      MIGRATION,
      /SELECT \* INTO section FROM "BaseConfigSection" WHERE "id" = NEW\."id";\s+IF NOT FOUND THEN/,
    );
  });
});

describe('a locked config', () => {
  it('is guarded on update and on delete', () => {
    assert.match(
      MIGRATION,
      /CREATE TRIGGER base_config_guard\s+BEFORE UPDATE OR DELETE ON "BaseConfig"/,
    );
  });

  /** The failure this prevents: rewriting the rules an already-sat paper was scored under. */
  for (const column of [
    'examStageId',
    'clonedFromId',
    'version',
    'totalQuestions',
    'totalMarks',
    'durationSec',
    'timerTemplate',
    'navigation',
    'optionalSectionCount',
    'defaultTestUi',
    'languageMode',
    'languages',
    'shuffleQuestions',
    'shuffleOptions',
    'calculatorEnabled',
    'featureFlags',
    'scoringVersion',
  ]) {
    it(`freezes ${column}`, () => {
      assert.match(
        MIGRATION,
        new RegExp(`NEW\\."${column}"\\s+IS DISTINCT FROM OLD\\."${column}"`),
      );
    });
  }

  /** Freezing `locked` itself is what refuses an unlock while allowing a no-op re-assert. */
  it('cannot be unlocked', () => {
    assert.match(MIGRATION, /NEW\."locked"\s+IS DISTINCT FROM OLD\."locked"/);
  });

  /**
   * The failure this prevents: freezing every column would deadlock the stage. A stage
   * holds one default config, so promoting a clone means clearing isDefault on the
   * locked original — and the original cannot be deleted either.
   */
  for (const column of ['isDefault', 'isActive', 'name']) {
    it(`still allows ${column} to change, so clone-to-evolve works`, () => {
      const guard = /IF OLD\."locked" AND \(([\s\S]*?)\) THEN/.exec(MIGRATION);
      assert.ok(guard, 'the locked-config guard is missing');
      assert.doesNotMatch(guard[1] ?? '', new RegExp(`"${column}"`));
    });
  }

  /** Editing a section or a module changes the config's shape just as surely. */
  for (const [trigger, table] of [
    ['base_config_section_guard', 'BaseConfigSection'],
    ['base_config_module_guard', 'BaseConfigModule'],
  ]) {
    it(`guards its ${table} rows on insert, update and delete`, () => {
      assert.match(
        MIGRATION,
        new RegExp(
          `CREATE TRIGGER ${trigger}\\s+BEFORE INSERT OR UPDATE OR DELETE ON "${table}"\\s+FOR EACH ROW EXECUTE FUNCTION base_config_child_guard\\(\\)`,
        ),
      );
    });
  }

  /**
   * The failure this prevents: checking only the destination catches a section moved INTO
   * a locked config and misses one moved OUT of it — the same hole, from the side where
   * the locked config silently loses a section.
   */
  it('cannot have a section or module moved out of it', () => {
    assert.match(MIGRATION, /IF TG_OP <> 'INSERT' THEN\s+source_id := OLD\."baseConfigId";/);
    assert.match(MIGRATION, /IF TG_OP <> 'DELETE' THEN\s+target_id := NEW\."baseConfigId";/);
    assert.match(MIGRATION, /base_config_assert_unlocked\(LEAST\(source_id, target_id\)\)/);
    assert.match(MIGRATION, /base_config_assert_unlocked\(GREATEST\(source_id, target_id\)\)/);
  });

  /**
   * The failure this prevents: the child guards fire on a cascade, but by then the parent
   * row is gone and the lock lookup finds nothing — so deleting the config would take its
   * whole shape with it, silently.
   */
  it('cannot be deleted, so the cascade never reaches its sections', () => {
    assert.match(
      MIGRATION,
      /IF TG_OP = 'DELETE' THEN\s+IF OLD\."locked" THEN\s+RAISE EXCEPTION 'base config % is locked; it cannot be deleted'/,
    );
  });

  /**
   * The failure this prevents: a non-locking read lets a section edit and a concurrent
   * finalize both commit, changing the shape after the paper froze against it. FOR SHARE
   * would also conflict with the finalize, but it is weaker than the lock an ordinary
   * UPDATE takes, so "edit sections, then update the parent" has to upgrade — and two of
   * those deadlock.
   */
  it('is read at the strength an ordinary UPDATE takes, so writers queue instead of deadlocking', () => {
    assert.match(MIGRATION, /FROM "BaseConfig" WHERE "id" = config_id FOR NO KEY UPDATE/);
    assert.doesNotMatch(MIGRATION, /FROM "BaseConfig" WHERE "id" = config_id FOR SHARE/);
  });

  /** TRUNCATE fires no row triggers, so it would walk past every guard above. */
  for (const table of ['BaseConfig', 'BaseConfigSection', 'BaseConfigModule']) {
    it(`refuses a TRUNCATE of ${table}`, () => {
      assert.match(
        MIGRATION,
        new RegExp(
          `BEFORE TRUNCATE ON "${table}"\\s+FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard\\(\\)`,
        ),
      );
    });
  }
});

// --------------------------------------------------------------------------- family -> course
// ---------------------------------------------------------------------------

/** Prisma regenerates a rename as DROP + ADD, which empties the column in silence. */
describe('the course rename moves no data', () => {
  for (const object of [
    '"Exam" RENAME COLUMN "family"',
    '"Student" RENAME COLUMN "enrolledFamilies"',
  ]) {
    it(`renames ${object.split('"')[3]} rather than replacing it`, () => {
      assert.match(COURSE_RENAME, new RegExp(`ALTER TABLE ${escapeForRegex(object)}`));
    });
  }

  it('renames the enum type, so the values are untouched', () => {
    assert.match(COURSE_RENAME, /ALTER TYPE "ExamFamily" RENAME TO "ExamCourse"/);
  });

  /** The one statement that would lose every enrolment in the database. */
  it('drops nothing at all', () => {
    assert.doesNotMatch(COURSE_RENAME, /DROP\s+(COLUMN|TYPE|TABLE)/i);
  });

  /** Prisma derives an index name from its column, so a stale one reads as drift forever. */
  it('brings both indexes along', () => {
    assert.match(COURSE_RENAME, /ALTER INDEX "Exam_family_idx" RENAME TO "Exam_course_idx"/);
    assert.match(
      COURSE_RENAME,
      /ALTER INDEX "Student_enrolledFamilies_idx" RENAME TO "Student_enrolledCourses_idx"/,
    );
  });
});

// --------------------------------------------------------------------- a series and its kind
// ---------------------------------------------------------------------------

/** A row contradicting its own kind raises nothing; it resolves to the wrong students. */
describe('a series cannot contradict its kind', () => {
  for (const [constraint, prevents] of [
    ['TestSeries_branches_are_standard_only', 'a branch list on a kind that reaches past branches'],
    ['TestSeries_only_free_spans_no_stage', 'a non-FREE series with no stage to match against'],
    ['TestSeries_program_kind_names_its_program', 'a programCode and the PROGRAM kind parting'],
    ['TestSeries_event_kind_names_its_event', 'an eventId and the EVENT kind parting'],
  ] as const) {
    it(`refuses ${prevents}`, () => {
      assert.match(ACCESS_CONSTRAINTS, new RegExp(`ADD CONSTRAINT "${constraint}"\\s+CHECK`));
    });
  }

  /** No btree answers array containment, so the STANDARD arm scans every series without this. */
  it('seeks the branch list rather than scanning every series to find it', () => {
    assert.match(ACCESS_CONSTRAINTS, /CREATE INDEX "TestSeries_branchIds_idx"[\s\S]*?USING GIN/);
  });
});
