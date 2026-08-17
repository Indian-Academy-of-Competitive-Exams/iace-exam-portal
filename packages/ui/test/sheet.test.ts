import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as {
  theme: { extend: { animation: Record<string, string> } };
};

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const sheet = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/sheet.tsx'),
  'utf8',
);
const shell = readFileSync(
  path.resolve(REPO_ROOT, 'packages/app-kit/browser/app-shell.tsx'),
  'utf8',
);

describe('Sheet', () => {
  /**
   * It is the dialog primitive in a different shape, and that IS the point. A
   * hand-built drawer is an overlay plus a panel, and everything that makes it
   * safe is invisible: the focus trap, Escape, the scroll lock, the inert
   * background, and focus returning to the button that opened it.
   */
  it('is built on the dialog primitive, not on a positioned div', () => {
    assert.match(sheet, /@radix-ui\/react-dialog/);
    assert.match(sheet, /DialogPrimitive\.Portal/);
    assert.match(sheet, /DialogPrimitive\.Overlay/);
  });

  it('slides in from the edge it is anchored to', () => {
    for (const side of ['left', 'right']) {
      assert.match(sheet, new RegExp(`animate-sheet-in-${side}`));
      assert.ok(preset.theme.extend.animation[`sheet-in-${side}`]);
    }
  });
});

describe('the mobile nav drawer', () => {
  it('is a Sheet rather than a hand-built overlay', () => {
    assert.match(shell, /<SheetContent side="left"/);
    assert.ok(
      !/absolute inset-0 bg-\[--overlay-bg\]/.test(shell),
      'the hand-rolled overlay must be gone',
    );
  });

  /**
   * The panel's visible heading is a logo, which announces nothing. Without a
   * title a screen reader arrives in an unnamed region and has to guess what it
   * has been dropped into.
   */
  it('has a name, even though its heading is a logo', () => {
    assert.match(shell, /<SheetTitle className="sr-only">Navigation<\/SheetTitle>/);
  });
});
