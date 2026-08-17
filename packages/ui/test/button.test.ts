import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const button = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/button.tsx'),
  'utf8',
);

describe('button loading', () => {
  /**
   * The whole point of showing a spinner is that a second click cannot land,
   * and only `disabled` actually stops one. A screen adding the spinner by hand
   * had to remember the disable as a separate decision, and not all of them did.
   *
   * `Boolean(disabled) || loading`, not `disabled ?? loading`: an explicit
   * `disabled={false}` is not nullish, so `??` would keep the button live
   * through the whole request.
   */
  it('disables while loading, whatever the caller passed for disabled', () => {
    assert.match(button, /disabled=\{Boolean\(disabled\) \|\| loading\}/);
  });

  /**
   * A bare <button> submits the form it is standing in. Only the buttons that
   * mean to submit say `type="submit"`; the rest would otherwise post the form
   * on a click meant to open a panel, and the failure reads as a bug in the
   * form rather than in the button.
   */
  it('defaults to type=button so it cannot submit a form by accident', () => {
    assert.match(button, /type = 'button',/);
    assert.match(button, /<button\s+type=\{type\}/);
  });

  /** A spinner is a picture. A screen reader is told in words or not at all. */
  it('announces itself busy', () => {
    assert.match(button, /aria-busy=\{loading \|\| undefined\}/);
  });

  /**
   * One slot, not two. The icon and the spinner occupy the same place, so a
   * running button never shows both — which would read as the action having
   * started twice.
   */
  it('swaps the icon for the spinner rather than adding one', () => {
    assert.match(button, /\{loading \? <Loader2 className="animate-spin" aria-hidden \/> : icon\}/);
  });
});

/**
 * The pattern this prop replaced, written out at the call site:
 *
 *   {m.isPending ? <Loader2 className="animate-spin" /> : <Icon />}
 *
 * Every copy is a fresh chance to pick a different spinner, forget the disable,
 * or leave out the announcement — which is exactly what had happened across the
 * dozen that existed.
 */
describe('hand-rolled button spinners', () => {
  it('are gone from the apps', () => {
    const offenders = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }).filter((relative) =>
      /isPending \? <Loader2/.test(readFileSync(path.join(REPO_ROOT, relative), 'utf8')),
    );

    assert.deepEqual(offenders, [], 'use <Button loading={…} icon={…}> instead');
  });
});
