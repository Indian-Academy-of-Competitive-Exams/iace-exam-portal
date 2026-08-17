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
/**
 * A spinner is for an action somebody just took. Content arriving into a page
 * has a shape — a table, a list, a card, a form — and `Skeleton` holds it while
 * it arrives; a spinner in its place collapses the region to a dot and then
 * throws the page around when the data lands.
 *
 * The four that remain are all actions or shapeless waits: reading a chosen
 * file (twice), fetching the next page of an already-open list, and the app
 * deciding whether anyone is signed in before there is a page at all.
 */
describe('spinners left in the product', () => {
  const ALLOWED = new Set([
    'apps/admin/src/routes/import-students.tsx',
    'apps/admin/src/routes/import-group-members.tsx',
    'packages/ui/src/components/ui/combobox.tsx',
    'packages/app-kit/browser/protected-route.tsx',
  ]);

  it('are only where an action is running, never where content is arriving', () => {
    const offenders = [
      ...globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }),
      ...globSync('packages/*/{src,browser}/**/*.tsx', { cwd: REPO_ROOT }),
    ].filter((relative) => {
      if (ALLOWED.has(relative) || relative.endsWith('ui/spinner.tsx')) return false;
      return /<(?:Spinner|LoadingState)\b/.test(
        readFileSync(path.join(REPO_ROOT, relative), 'utf8'),
      );
    });

    assert.deepEqual(
      offenders,
      [],
      'content on its way into a page uses Skeleton — it holds the shape it is about to fill',
    );
  });
});

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
