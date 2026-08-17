import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const appFiles = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT });
const readApp = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), 'utf8');

/** App files declaring a component of their own by this name. */
function appsDeclaring(name: string): string[] {
  const declaration = new RegExp(`^(?:export )?(?:function|const) ${name}\\b`, 'm');
  return appFiles.filter((relative) => declaration.test(readApp(relative)));
}

/**
 * A component that two screens both need belongs in @iace/ui, and the cost of
 * getting that wrong is invisible: both copies look right, one of them gets
 * fixed, and nobody compares two screens side by side to notice.
 *
 * These three were each written out more than once before they moved:
 *
 *   · the import summary row, byte-identical in both import screens
 *   · the tinted sign-in step glyph, byte-identical in BOTH APPS
 *   · the Field + Controller + PinInput sandwich, in three places, because
 *     FormField cannot serve a control that renders its own value
 */
describe('components that live in the design system', () => {
  for (const name of ['StatRow', 'StepIcon', 'PinField']) {
    it(`${name} is not re-declared inside an app`, () => {
      assert.deepEqual(appsDeclaring(name), [], `import ${name} from @iace/ui`);
    });
  }

  /**
   * The names they had before they moved. An app declaring one of these again
   * is the same component coming back under a different label, which is how a
   * design system quietly stops being the source of anything.
   */
  for (const name of ['Summary', 'DigitsField']) {
    it(`no app brings back ${name}`, () => {
      assert.deepEqual(appsDeclaring(name), []);
    });
  }
});
