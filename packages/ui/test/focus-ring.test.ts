import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const tokens = read('src/tokens.css');

/**
 * A focused field showed TWO concentric rings.
 *
 * tokens.css paints a ring on every focusable element, which is the right floor
 * — a control nobody has styled yet still shows focus. But Input and Select are
 * a wrapper around the real element, because a prefix, a suffix or a chevron
 * has to sit inside the same box, and the wrapper paints the border and the
 * ring itself. So the floor fired again on the inner <input> and drew a second
 * ring inside the first.
 *
 * The fix is a claim the wrapper makes (`data-focus-ring="wrapper"`) and a rule
 * that honours it. Both halves are asserted, because either one alone is
 * useless and neither is obviously load-bearing to someone tidying up.
 */
describe('focus ring', () => {
  it('stands the inner control down when a wrapper owns the ring', () => {
    assert.match(
      tokens,
      /\[data-focus-ring='wrapper'\]\s+:where\(input, select, textarea\):focus-visible\s*\{\s*box-shadow:\s*none;/,
      'tokens.css must suppress the inner ring inside a ring-owning wrapper',
    );
  });

  for (const component of ['input', 'select'] as const) {
    it(`${component}.tsx claims the ring on its wrapper`, () => {
      const source = read(`src/components/ui/${component}.tsx`);
      assert.ok(
        source.includes('data-focus-ring="wrapper"'),
        `${component}.tsx paints focus-within:shadow-focus on a wrapper, so it must also carry ` +
          'data-focus-ring="wrapper" or the inner control draws a second ring',
      );
      assert.ok(
        source.includes('focus-within:shadow-focus'),
        `${component}.tsx is expected to be a wrapper-ringed control`,
      );
    });
  }

  it('does not force a border-radius on focus', () => {
    // It used to, which squared off anything rounder than 6px the moment it was
    // tabbed into. A box-shadow ring already follows the element's own radius.
    const floor = /:where\(a, button, input[^}]*\):focus-visible\s*\{([^}]*)\}/.exec(tokens);
    assert.ok(floor?.[1], 'the global focus floor must exist');
    assert.ok(!floor[1].includes('border-radius'), 'the focus floor must not override radius');
  });
});
