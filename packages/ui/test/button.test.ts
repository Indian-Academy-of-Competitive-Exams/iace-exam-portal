import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** Each hand-written copy is a chance to pick a different spinner or forget the disable. */
describe('hand-rolled button spinners', () => {
  it('are gone from the apps', () => {
    const offenders = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }).filter((relative) =>
      /isPending \? <Loader2/.test(readFileSync(path.join(REPO_ROOT, relative), 'utf8')),
    );

    assert.deepEqual(offenders, [], 'use <Button loading={…} icon={…}> instead');
  });
});
