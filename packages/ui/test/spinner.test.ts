import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const spinner = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/spinner.tsx'),
  'utf8',
);

describe('Spinner', () => {
  /**
   * A spinner is a picture. Given a label it becomes a live region and says
   * what is being waited for; without one it is hidden entirely, because the
   * text beside it — "Reading the file…" — already carries the announcement and
   * marking both announces the wait twice.
   */
  it('announces itself only when nothing beside it does', () => {
    // <output> carries the live region natively; the glyph inside stays hidden
    // so the label is announced once, not alongside "graphic".
    assert.match(spinner, /label \? \(\s*<output aria-label=\{label\}/);
    assert.match(spinner, /<Loader2[\s\S]*?aria-hidden/);
  });

  it('LoadingState carries the announcement on the text, not the glyph', () => {
    const loading = spinner.slice(spinner.indexOf('export function LoadingState'));
    assert.match(loading, /<output/);
    assert.match(loading, /<Spinner size=\{size\} \/>/, 'the spinner inside it stays decorative');
  });
});

/**
 * `<Loader2 className="animate-spin" />` written out by hand was the same wait
 * drawn at four different sizes, sometimes with a colour and sometimes without.
 * Every remaining one belongs to Button (which owns its own pending state) or
 * to Spinner itself.
 */
describe('hand-rolled spinners', () => {
  it('are gone from the apps and the shared packages', () => {
    const allowed = new Set([
      'packages/ui/src/components/ui/spinner.tsx',
      'packages/ui/src/components/ui/button.tsx',
    ]);

    const offenders = [
      ...globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }),
      ...globSync('packages/*/{src,browser}/**/*.tsx', { cwd: REPO_ROOT }),
    ].filter(
      (relative) =>
        !allowed.has(relative) &&
        /<Loader2\b/.test(readFileSync(path.join(REPO_ROOT, relative), 'utf8')),
    );

    assert.deepEqual(offenders, [], 'use Spinner or LoadingState from @iace/ui');
  });
});
