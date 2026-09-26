import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { API_ROLES, onRole, rolePlays, roleNamed } from '../src/config/api-role';
import { AttemptsController } from '../src/attempts/attempts.controller';
import { MeLeaderboardController } from '../src/attempts/leaderboard.controller';
import { MeOverviewController } from '../src/attempts/overview.controller';
import { MePerformanceController } from '../src/attempts/performance.controller';
import { MeAttemptReportController } from '../src/attempts/attempt-report.controller';
import { MeQuestionReportController } from '../src/attempts/question-report.controller';
import { MeController } from '../src/me/me.controller';
import { SavedController } from '../src/saved/saved.controller';

describe('roleNamed', () => {
  it('reads the three roles, however they are typed', () => {
    assert.equal(roleNamed('exam'), API_ROLES.EXAM);
    assert.equal(roleNamed(' CORE '), API_ROLES.CORE);
    assert.equal(roleNamed('Worker'), API_ROLES.WORKER);
  });

  /** Unset is a developer's laptop and every test run: one container answering everything. */
  it('serves everything when nothing is named', () => {
    assert.equal(roleNamed(undefined), API_ROLES.ALL);
    assert.equal(roleNamed(''), API_ROLES.ALL);
  });

  /** A typo must not silently produce a container that answers nothing at all. */
  it('falls back to everything on a name it does not know', () => {
    assert.equal(roleNamed('exams'), API_ROLES.ALL);
  });
});

describe('rolePlays', () => {
  it('keeps what its own role is named in', () => {
    assert.equal(rolePlays(API_ROLES.EXAM, [API_ROLES.EXAM]), true);
    assert.equal(rolePlays(API_ROLES.WORKER, [API_ROLES.WORKER]), true);
  });

  it('drops what belongs to another role', () => {
    assert.equal(rolePlays(API_ROLES.EXAM, [API_ROLES.CORE]), false);
    assert.equal(rolePlays(API_ROLES.WORKER, [API_ROLES.EXAM, API_ROLES.CORE]), false);
  });

  /** The queues must never run in three places at once, and the sitting must never wait on them. */
  it('separates the sitting, the rest of the app and the queues', () => {
    assert.equal(rolePlays(API_ROLES.CORE, [API_ROLES.EXAM]), false);
    assert.equal(rolePlays(API_ROLES.EXAM, [API_ROLES.WORKER]), false);
  });

  it('plays every part when the role is ALL', () => {
    for (const wanted of [API_ROLES.EXAM, API_ROLES.CORE, API_ROLES.WORKER]) {
      assert.equal(rolePlays(API_ROLES.ALL, [wanted]), true);
    }
  });
});

describe('onRole', () => {
  it('hands back what a container registers, or nothing at all', () => {
    assert.deepEqual(onRole([API_ROLES.CORE], ['controller']), ['controller']);
    assert.deepEqual(onRole([API_ROLES.CORE], []), []);
  });
});

/** A route's full path, from Nest's own decorator metadata rather than any grep of source text. */
function routesOf(Controller: new (...args: never[]) => unknown): string[] {
  const prefix: string = Reflect.getMetadata(PATH_METADATA, Controller) ?? '';
  const prototype = Controller.prototype as Record<string, object>;
  const routes: string[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (name === 'constructor' || !handler) continue;
    if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
    routes.push(joinPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? ''));
  }
  return routes;
}

function joinPath(...segments: string[]): string {
  const trimmed = segments.map((segment) => segment.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${trimmed.join('/')}`;
}

/** Mirrors Caddy's `path` matcher: `*` spans `/`, the match is the whole path, case-insensitive. */
function caddyPathPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const CADDYFILE = readFileSync(join(__dirname, '../../../deploy/Caddyfile'), 'utf8');
const EXAM_MATCHER_LIST = /^\s*@exam\s+path\s+(.+)$/m.exec(CADDYFILE)?.[1] ?? '';
const EXAM_PATTERNS = EXAM_MATCHER_LIST.trim().split(/\s+/).filter(Boolean).map(caddyPathPattern);

const EXAM_ROUTES = [...routesOf(AttemptsController), ...routesOf(MeLeaderboardController)];
const CORE_ME_ROUTES = [
  ...routesOf(MeController),
  ...routesOf(MeAttemptReportController),
  ...routesOf(MeOverviewController),
  ...routesOf(MePerformanceController),
  ...routesOf(MeQuestionReportController),
  ...routesOf(SavedController),
];

describe('the Caddyfile exam matcher against the routes Nest actually registers', () => {
  /** Without this the two tests below pass vacuously on a Caddyfile that lost its matcher. */
  it('finds an @exam path matcher to check at all', () => {
    assert.ok(EXAM_PATTERNS.length > 0, 'deploy/Caddyfile must define an @exam path matcher');
  });

  it('reaches every route the exam role registers', () => {
    for (const route of EXAM_ROUTES) {
      assert.ok(
        EXAM_PATTERNS.some((pattern) => pattern.test(route)),
        `${route} is registered on the exam role but no @exam pattern in deploy/Caddyfile matches it`,
      );
    }
  });

  /** The list below cannot name a controller nobody has written yet; a dead pattern is the signal that one moved. */
  it('lists no pattern that has stopped matching an exam route', () => {
    for (const pattern of EXAM_PATTERNS) {
      assert.ok(
        EXAM_ROUTES.some((route) => pattern.test(route)),
        `${pattern.source} is forwarded to exam in deploy/Caddyfile but no exam route answers it`,
      );
    }
  });

  /** Catches the two prefix traps: exact `/me/performance`, and question-report living on core. */
  it('never reaches a core route that lives under /me/', () => {
    for (const route of CORE_ME_ROUTES) {
      assert.ok(
        EXAM_PATTERNS.every((pattern) => !pattern.test(route)),
        `${route} is registered on core but an @exam pattern in deploy/Caddyfile matches it`,
      );
    }
  });
});
