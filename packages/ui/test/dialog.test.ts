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
  /** Radix focuses the first focusable child, so the choice is taken away from DOM order. */
  it('gives the opening focus to Cancel, never the destructive button', () => {
    assert.match(
      dialog,
      /onOpenAutoFocus=\{\(event\) => \{\s*event\.preventDefault\(\);\s*cancelRef\.current\?\.focus\(\);/,
      'ConfirmDialog must move initial focus to the cancel button itself',
    );
  });

  /** Dismissing mid-request leaves the reader guessing whether it happened. */
  it('cannot be dismissed while the action it started is running', () => {
    for (const handler of ['onEscapeKeyDown', 'onPointerDownOutside', 'onInteractOutside']) {
      assert.ok(
        dialog.includes(`${handler}={blockWhileLoading}`),
        `${handler} must be blocked while loading`,
      );
    }
    assert.match(dialog, /if \(loading\) event\.preventDefault\(\)/);
  });

  /** One definition per component: the raw CSS copy could not trap focus. */
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

/** `globalThis.confirm` blocks the tab, cannot be themed and cannot be tested. */
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
