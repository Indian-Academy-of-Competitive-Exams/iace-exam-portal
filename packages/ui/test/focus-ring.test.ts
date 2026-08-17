import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const tokens = read('src/tokens.css');

/**
 * tokens.css rings every focusable element; a wrapper control would draw a second ring
 * inside its own. Both halves of the opt-out are asserted — either alone is useless.
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
