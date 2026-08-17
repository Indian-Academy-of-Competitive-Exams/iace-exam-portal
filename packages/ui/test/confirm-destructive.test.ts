import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { plural } from '../src/lib/utils';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * Calls that destroy a record, revoke somebody's access, or create a way into
 * the product. Matched on the API surface rather than on wording, because the
 * button label is the part most likely to be reworded.
 */
const NEEDS_CONFIRMING = [
  /api\.admin\.\w+\.remove\(/,
  /api\.admin\.\w+\.setActive\(/,
  /api\.admin\.admins\.create\(/,
  /api\.admin\.sync\./,
] as const;

/**
 * Anything that deletes, revokes, grants or changes what somebody can do asks
 * first — in a dialog that says what it does, not a chip that says "Delete?".
 *
 * The wording is the point as much as the extra click. "Delete?" beside a row
 * is a speed bump; it cannot say that the group is how 240 students reach their
 * tests, that a retired branch would keep everything while a deleted one is
 * refused outright, or that a super admin can create more super admins. A
 * reader who knew all that would sometimes stop, and the whole reason to
 * interrupt them is the times they would.
 *
 * Reversibility is not the test — visibility is. Retiring a branch is undone by
 * the button beside it and still asks, because nothing on that row changes
 * except a badge while the consequence lands weeks later on somebody else, as a
 * branch that will not accept the group they are creating.
 *
 * Two things deliberately do NOT ask, both because the effect is already in
 * front of the reader, and both worth naming so the omissions read as decisions:
 *
 *   · Committing an import — the screen is built around a preview listing every
 *     row and what would happen to it. Asking after showing the answer adds a
 *     step and no information.
 *   · The permission grid — the checkbox IS the state, the admin it applies to
 *     is named at the top of the panel, and one tick is undone by the same tick.
 *     A dialog per checkbox would make setting up an admin unusable, which is
 *     how people learn to click through the dialogs that matter.
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

  /**
   * The chip-sized confirm these replaced. It came back once already as a
   * second copy in another screen, so it is worth naming: the failure is not
   * one bad row, it is that copying it looked like the way to confirm here.
   */
  /**
   * A toggle asks in BOTH directions. One that sometimes asks and sometimes
   * fires on a single click is one people stop reading — and the reverse
   * direction is usually where the fact nothing else says lives: reactivating
   * an admin restores their sign-in and not the grants that were dropped.
   */
  it('ask in both directions of a toggle', () => {
    const toggles = {
      'apps/admin/src/routes/admins.tsx': 'Reactivate',
      'apps/admin/src/routes/student-detail.tsx': 'Reactivate student',
      'apps/admin/src/routes/branches.tsx': 'Reactivate branch',
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

  it('are not confirmed by a chip in the row', () => {
    const offenders = appFiles.filter((relative) =>
      /<span[^>]*>\s*Delete\?\s*<\/span>|>\s*Yes, delete\s*</.test(
        readFileSync(path.join(REPO_ROOT, relative), 'utf8'),
      ),
    );

    assert.deepEqual(offenders, [], 'a confirmation says what it does — use ConfirmDialog');
  });
});

/**
 * "1 students" reads as a bug in the number rather than in the sentence, and a
 * confirmation is the last place to look careless about a count somebody is
 * about to act on.
 */
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
