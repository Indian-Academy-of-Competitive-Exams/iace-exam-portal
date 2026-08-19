import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { plural } from '../src/lib/utils';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** Matched on the API surface, not on wording — the label is what gets reworded. */
const NEEDS_CONFIRMING = [
  /api\.admin\.\w+\.remove\(/,
  /api\.admin\.\w+\.setActive\(/,
  /api\.admin\.admins\.create\(/,
  /api\.admin\.sync\./,
  /api\.admin\.features\.revoke\(/,
  /api\.admin\.features\.grant\(/,
] as const;

/**
 * Anything that deletes, revokes, grants or changes what somebody can do asks first.
 * The one exemption is the import commit, whose screen already previews every row.
 */
describe('destructive actions', () => {
  const appFiles = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT });

  it('always ask before they run', () => {
    const offenders = appFiles.filter((relative) => {
      const source = readFileSync(path.join(REPO_ROOT, relative), 'utf8');
      if (!NEEDS_CONFIRMING.some((pattern) => pattern.test(source))) return false;
      return !source.includes('<ConfirmDialog');
    });

    assert.deepEqual(
      offenders,
      [],
      'these delete, revoke or grant access with no confirmation — use ConfirmDialog from @iace/ui',
    );
  });

  /** The chip-sized confirm these replaced, which had already been copied once. */
  /** A toggle asks both ways: the reverse direction carries the fact nothing else says. */
  it('ask in both directions of a toggle', () => {
    const toggles = {
      'apps/admin/src/routes/admins.tsx': 'Reactivate',
      'apps/admin/src/routes/student-detail.tsx': 'Reactivate student',
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
      assert.ok(
        !/onClick=\{\(\) => setActive\.mutate\(/.test(source),
        `${relative}: a toggle must not fire straight from a click`,
      );
    }
  });

  /** Retiring a branch is reversible AND asks — see the note above. */
  it('include the reversible switch whose effect is invisible from the row', () => {
    const branches = readFileSync(
      path.join(REPO_ROOT, 'apps/admin/src/routes/branches.tsx'),
      'utf8',
    );
    assert.ok(
      branches.includes("'Retire branch'"),
      'retiring a branch must go through a ConfirmDialog',
    );
  });

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

  it('are not confirmed by a chip in the row', () => {
    const offenders = appFiles.filter((relative) =>
      /<span[^>]*>\s*Delete\?\s*<\/span>|>\s*Yes, delete\s*</.test(
        readFileSync(path.join(REPO_ROOT, relative), 'utf8'),
      ),
    );

    assert.deepEqual(offenders, [], 'a confirmation says what it does — use ConfirmDialog');
  });
});

/** "1 students" reads as a bug in the number rather than in the sentence. */
describe('plural', () => {
  it('agrees with its count', () => {
    assert.equal(plural(0, 'student'), '0 students');
    assert.equal(plural(1, 'student'), '1 student');
    assert.equal(plural(240, 'student'), '240 students');
  });

  it('takes an irregular plural when the -s rule does not hold', () => {
    assert.equal(plural(1, 'entry', 'entries'), '1 entry');
    assert.equal(plural(3, 'entry', 'entries'), '3 entries');
  });
});
