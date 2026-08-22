import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatFileSize } from '../src/components/ui/file-dropzone';

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
