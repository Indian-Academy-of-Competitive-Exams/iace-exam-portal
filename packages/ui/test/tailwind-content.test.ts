import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as { content: string[] };

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** Every file the preset tells Tailwind to read, as absolute paths. */
function scannedFiles(): Set<string> {
  return new Set(
    preset.content.flatMap((pattern) => globSync(pattern)).map((f) => path.resolve(f)),
  );
}

/**
 * Every shared component file that actually styles something. A `.tsx` with no
 * `className` in it contributes no classes, so leaving it unscanned costs
 * nothing and it is not worth failing over.
 */
function filesThatStyleSomething(): string[] {
  return globSync('packages/*/{src,browser}/**/*.tsx', { cwd: REPO_ROOT })
    .map((f) => path.resolve(REPO_ROOT, f))
    .filter((f) => readFileSync(f, 'utf8').includes('className'));
}

/**
 * Tailwind only emits a class it has SEEN in a scanned file. A package left out
 * of `content` therefore does not fail the build — it produces a build that is
 * quietly missing CSS, which shows up as a layout bug and gets debugged as one.
 *
 * That is not hypothetical here. `packages/app-kit/browser/app-shell.tsx` holds
 * the whole signed-in chrome and went unscanned: `max-w-6xl` was never emitted
 * so the shell had no max width, `py-8` was never emitted so the nav sat flush
 * against the page, and `sm:inline` was never emitted so the responsive rules
 * did nothing. Every one of those reads as a design mistake rather than a
 * missing glob.
 *
 * So the guarantee is asserted directly: if a shared file styles something, the
 * preset must be reading it.
 */
describe('tailwind preset content coverage', () => {
  it('scans every shared file that uses className', () => {
    const scanned = scannedFiles();
    const missing = filesThatStyleSomething().filter((f) => !scanned.has(f));

    assert.deepEqual(
      missing.map((f) => path.relative(REPO_ROOT, f)),
      [],
      'these style something but Tailwind never reads them, so their classes are silently dropped — ' +
        'widen `content` in packages/ui/tailwind.preset.js',
    );
  });

  it('covers the shell, which is the file that proved this matters', () => {
    const shell = path.resolve(REPO_ROOT, 'packages/app-kit/browser/app-shell.tsx');
    assert.ok(scannedFiles().has(shell), 'app-shell.tsx must be scanned');
  });

  it('resolves independently of the working directory', () => {
    // The apps build from apps/<name>, not the repo root. A relative glob would
    // resolve against the wrong base and match nothing — silently, again.
    for (const pattern of preset.content) {
      assert.ok(path.isAbsolute(pattern), `content glob must be absolute: ${pattern}`);
    }
  });
});
