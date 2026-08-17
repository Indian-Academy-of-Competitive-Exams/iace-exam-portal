import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as {
  theme: { extend: { animation: Record<string, string> } };
};

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const dialog = read('src/components/ui/dialog.tsx');
const components = read('src/components.css');

describe('dialog', () => {
  /**
   * The rule the style guide states and a call site cannot be trusted to
   * remember: Enter on a confirm that appeared under someone's fingers must not
   * be the thing that deletes. Radix focuses the first focusable child, which
   * is whichever button the markup happens to put first — so ConfirmDialog
   * takes the choice away from the DOM order and aims it at Cancel.
   */
  it('gives the opening focus to Cancel, never the destructive button', () => {
    assert.match(
      dialog,
      /onOpenAutoFocus=\{\(event\) => \{\s*event\.preventDefault\(\);\s*cancelRef\.current\?\.focus\(\);/,
      'ConfirmDialog must move initial focus to the cancel button itself',
    );
  });

  /**
   * A dialog whose work is still in flight must not vanish under an Escape or a
   * stray click — the reader is left guessing whether the thing they asked for
   * happened.
   */
  it('cannot be dismissed while the action it started is running', () => {
    for (const handler of ['onEscapeKeyDown', 'onPointerDownOutside', 'onInteractOutside']) {
      assert.ok(
        dialog.includes(`${handler}={blockWhileLoading}`),
        `${handler} must be blocked while loading`,
      );
    }
    assert.match(dialog, /if \(loading\) event\.preventDefault\(\)/);
  });

  /**
   * ONE DEFINITION PER COMPONENT. The raw CSS could not trap focus, and leaving
   * it beside the React component would leave two designs of one thing, only
   * one of which anybody renders.
   */
  it('is the only modal definition — components.css declares no .modal', () => {
    assert.ok(!/^\.modal/m.test(components), 'components.css must not declare .modal classes');
    assert.ok(!/^\.overlay/m.test(components), 'components.css must not declare .overlay');
  });

  /** The entry animations it names have to exist, or it simply appears. */
  it('uses animations the preset declares', () => {
    for (const name of ['overlay-in', 'dialog-in']) {
      assert.ok(dialog.includes(`animate-${name}`), `dialog.tsx should use animate-${name}`);
      assert.ok(preset.theme.extend.animation[name], `preset must declare the ${name} animation`);
    }
  });
});

/**
 * `globalThis.confirm` blocks the whole tab, cannot be themed, cannot be
 * tested, and renders its message as one unstyled line — so the sentence that
 * explains what will NOT be undone reads like a warning from the browser rather
 * than from the product. ConfirmDialog exists so nobody reaches for it again.
 */
describe('native confirm', () => {
  it('is gone from every app and package', () => {
    const sources = [
      ...globSync('apps/*/src/**/*.{ts,tsx}', { cwd: REPO_ROOT }),
      ...globSync('packages/*/{src,browser}/**/*.{ts,tsx}', { cwd: REPO_ROOT }),
    ];

    const offenders = sources.filter((relative) =>
      /(?:globalThis|window)\.confirm\s*\(/.test(
        readFileSync(path.join(REPO_ROOT, relative), 'utf8'),
      ),
    );

    assert.deepEqual(
      offenders,
      [],
      'use ConfirmDialog from @iace/ui instead of the native confirm',
    );
  });
});
