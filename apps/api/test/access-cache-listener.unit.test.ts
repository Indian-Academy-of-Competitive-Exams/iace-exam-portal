import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import type { AccessResolverService } from '../src/access/access-resolver.service';

describe('AccessCacheListener', () => {
  /** The write already happened. A Redis blip must not fail the request behind it. */
  it('swallows a failing bump rather than failing the producer', async () => {
    const failing = {
      invalidateAll: () => Promise.reject(new Error('redis is down')),
    } as unknown as AccessResolverService;
    const listener = new AccessCacheListener(failing);

    await assert.doesNotReject(() => listener.onCatalogChanged({ testSeriesId: 'srs_1' }));
    await assert.doesNotReject(() => listener.onExamStageChanged({ examStageId: 'stg_1' }));
  });
});
