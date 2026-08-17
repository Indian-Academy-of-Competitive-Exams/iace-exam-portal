import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const progress = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/progress.tsx'),
  'utf8',
);

describe('Progress', () => {
  /**
   * The native element announces itself as a progress bar with its value and
   * has an indeterminate state built in. A div would have to earn both back
   * with ARIA that is easy to get subtly wrong.
   */
  it('is the native element, not a div wearing a progressbar role', () => {
    assert.match(progress, /<progress/);
    assert.ok(!/role="progressbar"/.test(progress));
  });

  /**
   * WebKit splits the track and the fill into two pseudo-elements; Firefox
   * treats the element itself as the track and has only the fill. Miss any of
   * the three and the bar is invisible in one browser and fine in another —
   * the kind of difference nobody notices until it is reported from outside.
   */
  it('styles the track and the fill in both engines', () => {
    for (const selector of [
      'bg-muted',
      '[&::-webkit-progress-bar]:bg-muted',
      '[&::-webkit-progress-value]:bg-primary',
      '[&::-moz-progress-bar]:bg-primary',
    ]) {
      assert.ok(progress.includes(selector), `missing ${selector}`);
    }
  });

  /** An omitted value is the indeterminate state, not zero. */
  it('leaves value optional so unknown-length work can say so', () => {
    assert.match(progress, /value\?: number/);
  });
});
