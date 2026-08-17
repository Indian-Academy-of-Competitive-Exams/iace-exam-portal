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
  /** `??` would miss an explicit `disabled={false}` and leave the button live. */
  it('disables while loading, whatever the caller passed for disabled', () => {
    assert.match(button, /disabled=\{Boolean\(disabled\) \|\| loading\}/);
  });

  /** A bare <button> submits the form it stands in. */
  it('defaults to type=button so it cannot submit a form by accident', () => {
    assert.match(button, /type = 'button',/);
    assert.match(button, /<button\s+type=\{type\}/);
  });

  /** A spinner is a picture. A screen reader is told in words or not at all. */
  it('announces itself busy', () => {
    assert.match(button, /aria-busy=\{loading \|\| undefined\}/);
  });

  /** One slot: a running button never shows the icon and the spinner together. */
  it('swaps the icon for the spinner rather than adding one', () => {
    assert.match(button, /\{loading \? <Loader2 className="animate-spin" aria-hidden \/> : icon\}/);
  });
});

/** Each hand-written copy is a chance to pick a different spinner or forget the disable. */
describe('hand-rolled button spinners', () => {
  it('are gone from the apps', () => {
    const offenders = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }).filter((relative) =>
      /isPending \? <Loader2/.test(readFileSync(path.join(REPO_ROOT, relative), 'utf8')),
    );

    assert.deepEqual(offenders, [], 'use <Button loading={…} icon={…}> instead');
  });
});
