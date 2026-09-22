import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { corsOrigin, helmetOptions } from '../src/common/security-headers';
import { NO_EVICTION, evictionRisk } from '../src/redis/eviction-policy';
import { THREADPOOL_FLOOR, threadpoolRisk } from '../src/common/threadpool';
import { NODE_ENVS, validateEnv } from '../src/config/env.schema';
import { signedWith } from '../src/storage/storage.service';
import { AppConfigService } from '../src/config/app-config.service';

const SECRET = 'x'.repeat(32);

function env(over: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://iace:iace@localhost:5432/iace',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: SECRET,
    JWT_REFRESH_SECRET: SECRET,
    PIN_PEPPER: SECRET,
    S3_BUCKET: 'iace-local',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    ...over,
  };
}

/** Everything production insists on, so a test can vary the one thing it is about. */
const production = (over: Record<string, string> = {}): Record<string, string> =>
  env({
    NODE_ENV: NODE_ENVS.PRODUCTION,
    CORS_ORIGINS: 'https://admin.iace.co.in',
    METRICS_TOKEN: 'scraper-token',
    DATABASE_URL: SIZED_POOL,
    ...over,
  });

const SIZED_POOL = 'postgresql://iace:iace@db:5432/iace?schema=public&connection_limit=25';

describe('when the environment is read', () => {
  /** The failure this prevents: a unit test importing a service and finding it needs a Redis URL. */
  it('is checked as the service is built, which is boot and never an import', () => {
    const held = process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
    try {
      assert.throws(() => new AppConfigService(), /JWT_ACCESS_SECRET/);
    } finally {
      if (held !== undefined) process.env.JWT_ACCESS_SECRET = held;
    }
  });
});

describe('CORS allowlist', () => {
  /** `origin: true` reflects whatever origin asks and answers it with credentials. */
  it('refuses to boot production with no allowlist', () => {
    assert.throws(() => validateEnv(production({ CORS_ORIGINS: '' })), /CORS_ORIGINS.*production/s);
  });

  it('boots production once the SPAs are named', () => {
    const parsed = validateEnv(production({ CORS_ORIGINS: 'https://admin.iace.co.in' }));

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

describe('the metrics endpoint', () => {
  /** Live attempt counts and error rates are worth something to somebody who should not have them. */
  it('refuses to boot production with no scraper token', () => {
    assert.throws(
      () => validateEnv(production({ METRICS_TOKEN: '' })),
      /METRICS_TOKEN.*production/s,
    );
  });

  it('leaves development open, so a local Prometheus needs no secret', () => {
    assert.equal(validateEnv(env()).METRICS_TOKEN, undefined);
  });
});

describe('the database pool', () => {
  /** The bug this prevents: 20 worker slots per container queueing on Prisma's default pool as P2024. */
  it('refuses to boot production on a URL that never sized it', () => {
    assert.throws(
      () => validateEnv(production({ DATABASE_URL: 'postgresql://iace:iace@db:5432/iace' })),
      /DATABASE_URL.*connection_limit/s,
    );
  });

  it('boots production once the pool is sized', () => {
    assert.equal(validateEnv(production()).DATABASE_URL, SIZED_POOL);
  });

  it('leaves development alone, where one process serves everything', () => {
    assert.ok(validateEnv(env()).DATABASE_URL);
  });
});

describe('the libuv thread pool', () => {
  /** The bug this prevents: a login burst holding all four threads while gzip waits behind it. */
  it('names the risk when nothing sized the pool', () => {
    assert.match(threadpoolRisk(undefined) ?? '', /unset.*4/s);
    assert.match(threadpoolRisk('4') ?? '', /UV_THREADPOOL_SIZE is "4"/);
  });

  it('is satisfied at the floor and above it', () => {
    assert.equal(threadpoolRisk(String(THREADPOOL_FLOOR)), null);
    assert.equal(threadpoolRisk(String(THREADPOOL_FLOOR * 2)), null);
  });

  /** A value libuv itself would ignore must read as unsized, not as somebody's deliberate choice. */
  it('treats a value that is not a whole number as no answer at all', () => {
    for (const raw of ['', 'sixteen', '16.5', '-16']) {
      assert.notEqual(threadpoolRisk(raw), null, `"${raw}" passed as a pool size`);
    }
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

describe('object storage credentials', () => {
  /** On Fargate the task role signs, so a key pair is one fewer secret to store and rotate. */
  it('boots against AWS with no keys at all', () => {
    const parsed = validateEnv(
      env({ S3_ENDPOINT: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' }),
    );

    assert.equal(parsed.S3_ACCESS_KEY_ID, undefined);
    assert.equal(signedWith(parsed.S3_ACCESS_KEY_ID, parsed.S3_SECRET_ACCESS_KEY), undefined);
  });

  it('hands MinIO the pair it has no role to borrow instead', () => {
    const parsed = validateEnv(env());

    assert.deepEqual(signedWith(parsed.S3_ACCESS_KEY_ID, parsed.S3_SECRET_ACCESS_KEY), {
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  /** Half a pair signs nothing: the SDK would fall back to a role that is not there. */
  it('refuses one key without the other', () => {
    assert.throws(() => validateEnv(env({ S3_SECRET_ACCESS_KEY: '' })), /S3_ACCESS_KEY_ID/);
  });

  it('refuses an endpoint of our own with no key to reach it', () => {
    assert.throws(
      () => validateEnv(env({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' })),
      /S3_ACCESS_KEY_ID/,
    );
  });
});
