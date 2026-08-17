import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as {
  theme: { extend: { animation: Record<string, string> } };
};

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const skeleton = read('src/components/ui/skeleton.tsx');
const components = read('src/components.css');

describe('Skeleton', () => {
  /**
   * The global reduced-motion rule in tokens.css shortens every animation to
   * 0.01ms. For a looping sweep that is not "no motion" — it is the sheen
   * jumping to its end position and parking there, a bright band across the
   * placeholder that looks like part of the design. So the sweep is removed
   * outright rather than sped up.
   */
  it('drops the sweep for reduced motion instead of just shortening it', () => {
    assert.match(skeleton, /motion-reduce:after:hidden/);
  });

  it('uses the sweep the preset declares', () => {
    assert.match(skeleton, /after:animate-skeleton-sweep/);
    assert.ok(preset.theme.extend.animation['skeleton-sweep']);
  });

  /**
   * The last line of a real paragraph is short. A stack of equal full-width
   * bars is the tell that gives away a fake skeleton.
   */
  it('ends a paragraph on a short line', () => {
    assert.match(skeleton, /index === lines - 1 \? 'w-\[62%\]'/);
  });

  /** ONE DEFINITION PER COMPONENT — the raw CSS copy is gone. */
  it('is the only skeleton — components.css declares none', () => {
    assert.ok(!/^\.skeleton/m.test(components), 'components.css must not declare .skeleton');
  });
});
