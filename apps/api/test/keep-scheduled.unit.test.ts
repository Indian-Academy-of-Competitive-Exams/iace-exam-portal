import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { type Queue } from 'bullmq';
import { keepScheduled } from '../src/queue/keep-scheduled';

const queueOver = (backend: EventEmitter) => ({ backend }) as unknown as Pick<Queue, 'backend'>;

describe('keepScheduled', () => {
  it('registers at once, and again each time the connection comes back', async () => {
    const backend = new EventEmitter();
    let registered = 0;

    await keepScheduled(queueOver(backend), () => {
      registered += 1;
      return Promise.resolve();
    });
    assert.equal(registered, 1);

    backend.emit('ready');
    backend.emit('ready');
    assert.equal(registered, 3);
  });

  it('survives a registration that fails on reconnect, and tries on the next one', async () => {
    const backend = new EventEmitter();
    let registered = 0;
    let refuse = false;

    await keepScheduled(queueOver(backend), () => {
      registered += 1;
      return refuse ? Promise.reject(new Error('redis is still loading')) : Promise.resolve();
    });

    refuse = true;
    backend.emit('ready');
    await new Promise((resolve) => setImmediate(resolve));

    refuse = false;
    backend.emit('ready');
    assert.equal(registered, 3);
  });

  it('fails the boot when the first registration fails', async () => {
    await assert.rejects(
      keepScheduled(queueOver(new EventEmitter()), () => Promise.reject(new Error('no redis'))),
      /no redis/,
    );
  });
});
