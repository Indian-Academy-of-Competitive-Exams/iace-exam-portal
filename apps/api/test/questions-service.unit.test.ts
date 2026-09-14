import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QuestionsService } from '../src/questions/questions.service';
import { AuditContext } from '../src/audit';
import { FakeStorage } from './support/fakes';
import { pngBytes } from './support/image-bytes';

/** Saving an image never reads the bank, so no client stands behind it. */
const withStorage = (storage: FakeStorage) =>
  new QuestionsService({} as never, new AuditContext(), storage as never);

describe('saveImage', () => {
  it('stores the bytes and hands back the key, plus a url to show it with', async () => {
    const storage = new FakeStorage();
    const buffer = pngBytes(800, 600);

    const saved = await withStorage(storage).saveImage({
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
    });

    assert.ok(saved.key.startsWith('questions/images/'));
    assert.deepEqual(storage.objects.get(saved.key), buffer);
    assert.ok(saved.url.includes(saved.key), 'the url has to point at what was just stored');
  });

  /** Content quotes the key; a rejected upload must not leave one behind for it to quote. */
  it('refuses before it uploads, so a bad file leaves nothing in the bucket', async () => {
    const storage = new FakeStorage();

    await assert.rejects(() =>
      withStorage(storage).saveImage({
        buffer: Buffer.from('<svg/>'),
        size: 6,
        mimetype: 'image/svg+xml',
      }),
    );
    assert.equal(storage.objects.size, 0);
  });
});
