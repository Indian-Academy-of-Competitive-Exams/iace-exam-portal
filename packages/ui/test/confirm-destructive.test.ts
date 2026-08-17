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
 * Anything that deletes, revokes or hands out access asks first — in a dialog
 * that says what it does, not a chip that says "Delete?".
 *
 * The wording is the point as much as the extra click. "Delete?" beside a row
 * is a speed bump; it cannot say that the group is how 240 students reach their
 * tests, that a retired branch would keep everything while a deleted one is
 * refused outright, or that a super admin can create more super admins. A
 * reader who knew all that would sometimes stop, and the whole reason to
 * interrupt them is the times they would.
 *
 * Two actions deliberately do NOT ask, and both are worth naming so the
 * omissions read as decisions:
 *
 *   · Retiring a branch — reversible by the button beside it, and it changes
 *     nothing that exists. A dialog in front of a reversible switch teaches
 *     people to click through dialogs.
 *   · Committing an import — the screen is built around a preview that already
 *     lists every row and what would happen to it. Asking again after showing
 *     the answer adds a step and no information.
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
