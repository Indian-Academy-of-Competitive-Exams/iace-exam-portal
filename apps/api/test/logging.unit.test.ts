import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { appLogger } from '../src/common/logging';

const restore = { NODE_ENV: process.env.NODE_ENV, LOG_LEVEL: process.env.LOG_LEVEL };

function withEnv(nodeEnv: string | undefined, logLevel: string | undefined) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = logLevel;
  return appLogger();
}

afterEach(() => {
  process.env.NODE_ENV = restore.NODE_ENV;
  process.env.LOG_LEVEL = restore.LOG_LEVEL;
});

describe('appLogger', () => {
  /** The per-request line is a debug, and 150 a second through an event buries every other line. */
  it('keeps the per-request flood out of production', () => {
    const logger = withEnv('production', undefined);

    assert.equal(logger.isLevelEnabled('debug'), false);
    assert.equal(logger.isLevelEnabled('verbose'), false);
    assert.equal(logger.isLevelEnabled('log'), true);
    assert.equal(logger.isLevelEnabled('warn'), true);
    assert.equal(logger.isLevelEnabled('error'), true);
  });

  it('shows every call outside production', () => {
    assert.equal(withEnv('development', undefined).isLevelEnabled('debug'), true);
    assert.equal(withEnv('test', undefined).isLevelEnabled('debug'), true);
  });

  /** The escape hatch: debugging a live box is one variable and a restart, not a deploy. */
  it('lets LOG_LEVEL override either default', () => {
    assert.equal(withEnv('production', '>=debug').isLevelEnabled('debug'), true);
    assert.equal(withEnv('development', '>=warn').isLevelEnabled('log'), false);
    assert.equal(withEnv('development', 'error').isLevelEnabled('warn'), false);
  });

  /** An unset variable reads as '' from a .env file, which filterLogLevels would take as "everything". */
  it('treats a blank LOG_LEVEL as unset rather than as full output', () => {
    assert.equal(withEnv('production', '   ').isLevelEnabled('debug'), false);
  });
});
