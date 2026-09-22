import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_ROLES, onRole, rolePlays, roleNamed } from '../src/config/api-role';

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
