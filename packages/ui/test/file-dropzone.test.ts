import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { formatFileSize } from '../src/components/ui/file-dropzone';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const source = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/file-dropzone.tsx'),
  'utf8',
);

describe('formatFileSize', () => {
  it('reads as a size, not as a byte count', () => {
    assert.equal(formatFileSize(0), '0 KB');
    assert.equal(formatFileSize(2048), '2 KB');
    assert.equal(formatFileSize(1024 * 1023), '1023 KB');
  });

  it('switches to MB before the number stops meaning anything', () => {
    // 15000 KB is a number the reader has to do arithmetic on.
    assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
    assert.equal(formatFileSize(1024 * 1024 * 14.6), '14.6 MB');
  });
});

describe('FileDropzone', () => {
  /**
   * The non-obvious line, and the reason two hand-written copies were a risk:
   * a file input holds the last chosen path, so choosing the SAME file twice
   * fires `change` once. Whoever is re-picking has usually just fixed the file
   * and saved over the top — to them the second pick simply does nothing.
   */
  it('clears the input so the same file can be chosen twice', () => {
    assert.match(source, /event\.target\.value = '';/);
  });

  /**
   * The input is `sr-only`, so the focus ring it would paint is invisible. The
   * label has to carry it or the control can be tabbed to with nothing on
   * screen saying where the focus went.
   */
  it('paints the focus ring on the label, since the input is hidden', () => {
    assert.match(source, /focus-within:border-ring focus-within:shadow-focus/);
  });

  it('accepts a dropped file, not just a clicked one', () => {
    assert.match(source, /onDrop=/);
    assert.match(source, /event\.dataTransfer\.files\[0\]/);
  });

  it('is the only copy — no screen hand-rolls a dashed file label', () => {
    const offenders = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }).filter((relative) =>
      /border-dashed[^"]*"[\s\S]{0,400}?type="file"/.test(
        readFileSync(path.join(REPO_ROOT, relative), 'utf8'),
      ),
    );

    assert.deepEqual(offenders, [], 'use FileDropzone from @iace/ui');
  });
});
