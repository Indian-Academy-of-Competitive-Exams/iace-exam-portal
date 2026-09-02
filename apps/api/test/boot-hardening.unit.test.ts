import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { corsOrigin, helmetOptions } from '../src/common/security-headers';
import { NO_EVICTION, evictionRisk } from '../src/redis/eviction-policy';
import { NODE_ENVS, validateEnv } from '../src/config/env.schema';

const SECRET = 'x'.repeat(32);

function env(over: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://iace:iace@localhost:5432/iace',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: SECRET,
    JWT_REFRESH_SECRET: SECRET,
    PIN_PEPPER: SECRET,
    S3_BUCKET: 'iace-local',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    ...over,
  };
}

describe('CORS allowlist', () => {
  /** `origin: true` reflects whatever origin asks and answers it with credentials. */
  it('refuses to boot production with no allowlist', () => {
    assert.throws(
      () => validateEnv(env({ NODE_ENV: NODE_ENVS.PRODUCTION })),
      /CORS_ORIGINS.*production/s,
    );
  });

  it('boots production once the SPAs are named', () => {
    const parsed = validateEnv(
      env({ NODE_ENV: NODE_ENVS.PRODUCTION, CORS_ORIGINS: 'https://admin.iace.co.in' }),
    );

    assert.deepEqual(parsed.CORS_ORIGINS, ['https://admin.iace.co.in']);
  });

  it('leaves development permissive, so a new port needs no env edit', () => {
    assert.equal(corsOrigin([], false), true);
  });

  /** Belt to the schema's braces: closed, never reflected, if one ever reaches here empty. */
  it('sends no allow-origin at all in production with an empty list', () => {
    assert.equal(corsOrigin([], true), false);
  });

  it('answers only the named origins when there are any', () => {
    assert.deepEqual(corsOrigin(['https://admin.iace.co.in'], true), ['https://admin.iace.co.in']);
  });
});

describe('security headers', () => {
  /** A JSON API loads nothing and frames nothing, so its policy says exactly that. */
  it('denies everything and refuses to be framed', () => {
    const csp = helmetOptions.contentSecurityPolicy;
    assert.ok(typeof csp === 'object');

    assert.deepEqual(csp.directives?.['default-src'], ["'none'"]);
    assert.deepEqual(csp.directives?.['frame-ancestors'], ["'none'"]);
    assert.deepEqual(csp.directives?.['object-src'], ["'none'"]);
    assert.equal(csp.useDefaults, false);
  });
});

describe('evictionRisk', () => {
  it('passes the one policy that keeps a sitting alive', () => {
    assert.equal(evictionRisk(NO_EVICTION), null);
  });

  /** An LRU eviction mid-exam drops the answers of whoever was quietest, silently. */
  it('is fatal on a policy that drops keys, and names it', () => {
    const risk = evictionRisk('allkeys-lru');

    assert.equal(risk?.fatal, true);
    assert.match(risk.message, /allkeys-lru/);
  });

  /** Managed Redis often refuses CONFIG GET — unknown is worth saying, not worth refusing to boot. */
  it('warns rather than refuses when the policy cannot be read', () => {
    const risk = evictionRisk(null);

    assert.equal(risk?.fatal, false);
    assert.match(risk.message, /noeviction/);
  });
});
