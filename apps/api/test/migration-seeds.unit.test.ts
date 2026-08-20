import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BRANCH_TYPE, GROUP_TYPE } from '@iace/contracts';

/**
 * Nothing in the application creates the all-students group, and the rule that protects it
 * (`groupEditBlocker`) assumes exactly one exists. The virtual branch is already created by
 * earlier migrations, so this one only renames it — `branchEditBlocker` refuses that through
 * the UI, on purpose, so a migration is the only path left.
 */
const PRISMA_DIR = join(__dirname, '../../../prisma');
const MIGRATION = readFileSync(
  join(PRISMA_DIR, 'migrations/20260818120000_group_state_and_singletons/migration.sql'),
  'utf8',
);

describe('Group.isActive', () => {
  it('is added by the migration, so the schema and the database agree', () => {
    assert.match(
      MIGRATION,
      /ALTER TABLE "Group" ADD COLUMN\s+"isActive" BOOLEAN NOT NULL DEFAULT true/,
    );
  });
});

describe('the seeded all-students group', () => {
  it('seeds the GLOBAL group', () => {
    assert.match(MIGRATION, new RegExp(`INSERT INTO "Group"[\\s\\S]*'${GROUP_TYPE.GLOBAL}'`));
  });

  /** The failure this prevents: a re-run, or a database that already holds one, ending with two. */
  it('guards the insert on the type, not on the id', () => {
    assert.match(MIGRATION, /WHERE NOT EXISTS \(SELECT 1 FROM "Group" WHERE "type" = 'GLOBAL'\)/);
  });
});

describe('the virtual branch rename', () => {
  /** The virtual branch already exists by the time this migration runs — see the header comment. */
  it('does not insert a second branch', () => {
    assert.doesNotMatch(MIGRATION, /INSERT INTO "Branch"/);
  });

  /** Pins the operators, not just the operands — an OR'd variant matches every branch and dies on the second row's unique constraint. */
  it('guards the rename on type AND name AND the target name being free, AND-joined in that order', () => {
    assert.match(
      MIGRATION,
      new RegExp(
        `UPDATE "Branch" SET "name" = 'ONLINE'\\s+WHERE "type" = '${BRANCH_TYPE.VIRTUAL}'\\s+AND "name" = 'GLOBAL'\\s+AND NOT EXISTS \\(SELECT 1 FROM "Branch" WHERE "name" = 'ONLINE'\\)`,
      ),
    );
  });
});
