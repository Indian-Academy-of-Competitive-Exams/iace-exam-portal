import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as {
  theme: { extend: { colors: Record<string, unknown> } };
};

type ColorFn = (options: { opacityValue?: string | number }) => string;

function resolve(path: string): ColorFn {
  const parts = path.split('.');
  let node: unknown = preset.theme.extend.colors;
  for (const part of parts) node = (node as Record<string, unknown>)[part];
  return node as ColorFn;
}

/**
 * Tailwind asks for a colour in two different shapes, and conflating them broke
 * every colour utility in the app at once — silently, because an invalid
 * declaration is dropped and light mode's fallbacks look like the theme.
 */
describe('preset colour tokens', () => {
  const cases = [
    'background',
    'foreground.DEFAULT',
    'foreground.secondary',
    'primary.DEFAULT',
    'destructive.DEFAULT',
    'info.subtle',
  ];

  it('returns a plain var() when Tailwind passes its opacity VARIABLE', () => {
    // This is the shape used by every `bg-x` / `text-x` without a modifier —
    // i.e. almost all of them. Treating it as a number produced `NaN%`.
    for (const path of cases) {
      const value = resolve(path)({ opacityValue: 'var(--tw-bg-opacity)' });
      assert.match(value, /^var\(--[a-z-]+\)$/, `${path} must be a plain var()`);
      assert.ok(!value.includes('NaN'), `${path} produced NaN`);
    }
  });

  it('returns a plain var() when no opacity is passed at all', () => {
    for (const path of cases) {
      assert.match(resolve(path)({ opacityValue: undefined }), /^var\(--[a-z-]+\)$/);
    }
  });

  it('uses color-mix only for a real numeric alpha', () => {
    assert.equal(
      resolve('destructive.DEFAULT')({ opacityValue: 0.1 }),
      'color-mix(in srgb, var(--destructive) 10%, transparent)',
    );
    assert.equal(
      resolve('primary.DEFAULT')({ opacityValue: '0.14' }),
      'color-mix(in srgb, var(--primary) 14%, transparent)',
    );
  });

  it('never emits NaN for any shape Tailwind might pass', () => {
    for (const path of cases) {
      for (const opacityValue of [undefined, 'var(--tw-bg-opacity)', 1, 0.5, '0.25']) {
        assert.ok(
          !resolve(path)({ opacityValue }).includes('NaN'),
          `${path} produced NaN for ${String(opacityValue)}`,
        );
      }
    }
  });
});
