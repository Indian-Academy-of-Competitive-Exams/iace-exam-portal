import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIONS,
  AUTO_OFF_MODES,
  healthChecks,
  checkedIn,
  cleanName,
  othersCheckedIn,
  parseAutoOff,
  resourcesToChange,
  sameSecret,
  scheduleFor,
} from './logic.mjs';

const OFF_STATES = { api: 'stopped', valkey: 'stopped', db: 'stopped' };
const ON_STATES = { api: 'running', valkey: 'running', db: 'available' };
const NOON = Date.parse('2026-10-13T06:30:00.000Z');

test('on starts everything that is stopped', () => {
  assert.deepEqual(resourcesToChange(ACTIONS.ON, OFF_STATES, true), ['api', 'valkey', 'db']);
});

test('off stops everything that is running', () => {
  assert.deepEqual(resourcesToChange(ACTIONS.OFF, ON_STATES, true), ['api', 'valkey', 'db']);
});

test('shared resources are never touched once production shares them', () => {
  assert.deepEqual(resourcesToChange(ACTIONS.ON, OFF_STATES, false), ['api']);
  assert.deepEqual(resourcesToChange(ACTIONS.OFF, ON_STATES, false), ['api']);
  assert.deepEqual(
    resourcesToChange(ACTIONS.KEEP_OFF, { ...OFF_STATES, db: 'available' }, false),
    [],
  );
});

test('skips anything mid-transition', () => {
  const moving = { api: 'stopping', valkey: 'pending', db: 'starting' };
  assert.deepEqual(resourcesToChange(ACTIONS.ON, moving, true), []);
  assert.deepEqual(resourcesToChange(ACTIONS.OFF, moving, true), []);
});

test('keep-off stops a database AWS restarted, only while the API box is stopped', () => {
  assert.deepEqual(resourcesToChange(ACTIONS.KEEP_OFF, { ...OFF_STATES, db: 'available' }, true), [
    'db',
  ]);
  assert.deepEqual(resourcesToChange(ACTIONS.KEEP_OFF, ON_STATES, true), []);
  assert.deepEqual(resourcesToChange(ACTIONS.KEEP_OFF, OFF_STATES, true), []);
});

test('an unknown action changes nothing', () => {
  assert.deepEqual(resourcesToChange('reboot', ON_STATES, true), []);
});

test('cleanName keeps letters and digits and refuses a name with none', () => {
  assert.equal(cleanName('  Ravi   Kumar '), 'Ravi Kumar');
  assert.equal(cleanName('José Ñ'), 'José Ñ');
  assert.equal(cleanName('Ravi 🎉 <b>'), 'Ravi b');
  assert.equal(cleanName('x'.repeat(50)).length, 30);
  assert.equal(cleanName('!!! ...'), null);
  assert.equal(cleanName(undefined), null);
});

test('checkedIn lists who checked in, oldest first, and lets a check-in lapse after 12 hours', () => {
  const tags = [
    { Key: 'Name', Value: 'examprep-api-staging' },
    { Key: 'checkin:Priya', Value: '2026-10-13T05:00:00.000Z' },
    { Key: 'checkin:Ravi', Value: '2026-10-13T04:00:00.000Z' },
    { Key: 'checkin:Old', Value: '2026-10-12T18:00:00.000Z' },
  ];
  assert.deepEqual(checkedIn(tags, NOON), [
    { name: 'Ravi', since: '2026-10-13T04:00:00.000Z' },
    { name: 'Priya', since: '2026-10-13T05:00:00.000Z' },
  ]);
});

test('checkedIn drops a tag whose time does not parse', () => {
  assert.deepEqual(checkedIn([{ Key: 'checkin:Ravi', Value: 'yesterday-ish' }], NOON), []);
  assert.deepEqual(checkedIn(undefined, NOON), []);
});

test('othersCheckedIn leaves out the caller, whatever the case', () => {
  const list = [
    { name: 'Ravi', since: 'a' },
    { name: 'Priya', since: 'b' },
  ];
  assert.deepEqual(othersCheckedIn(list, 'ravi'), [{ name: 'Priya', since: 'b' }]);
  assert.equal(othersCheckedIn(list, null).length, 2);
});

test('parseAutoOff accepts the three settings', () => {
  assert.deepEqual(parseAutoOff({ mode: 'none', hours: 3 }), { mode: 'none' });
  assert.deepEqual(parseAutoOff({ mode: 'nightly', time: '21:00' }), {
    mode: 'nightly',
    time: '21:00',
  });
  assert.deepEqual(parseAutoOff({ mode: 'timed', hours: 4 }), { mode: 'timed', hours: 4 });
});

test('parseAutoOff refuses anything out of range', () => {
  for (const bad of [
    null,
    {},
    { mode: 'weekly' },
    { mode: 'nightly', time: '24:00' },
    { mode: 'nightly', time: '9:00' },
    { mode: 'nightly' },
    { mode: 'timed', hours: 0 },
    { mode: 'timed', hours: 25 },
    { mode: 'timed', hours: '4' },
    { mode: 'timed', hours: 2.5 },
  ]) {
    assert.equal(parseAutoOff(bad), null, JSON.stringify(bad));
  }
});

test('scheduleFor: nightly is a daily IST cron', () => {
  const nightly = { mode: AUTO_OFF_MODES.NIGHTLY, time: '21:05' };
  assert.deepEqual(scheduleFor(nightly, false, NOON), {
    expression: 'cron(5 21 * * ? *)',
    timezone: 'Asia/Kolkata',
    enabled: true,
  });
});

test('scheduleFor: timed fires that many hours from now, and only while staging is on', () => {
  const timed = { mode: AUTO_OFF_MODES.TIMED, hours: 4 };
  assert.deepEqual(scheduleFor(timed, true, NOON), {
    expression: 'at(2026-10-13T10:30:00)',
    timezone: 'UTC',
    enabled: true,
  });
  assert.equal(scheduleFor(timed, false, NOON).enabled, false);
});

test('scheduleFor: none is disabled', () => {
  assert.equal(scheduleFor({ mode: AUTO_OFF_MODES.NONE }, true, NOON).enabled, false);
});

test('sameSecret matches only the exact passcode, whatever is thrown at it', () => {
  assert.equal(sameSecret('open-sesame', 'open-sesame'), true);
  assert.equal(sameSecret('open-sesame ', 'open-sesame'), false);
  assert.equal(sameSecret(undefined, 'open-sesame'), false);
  assert.equal(sameSecret('x'.repeat(10_000), 'open-sesame'), false);
  assert.equal(sameSecret('పాస్‌కోడ్', 'open-sesame'), false);
});

test('healthChecks reads each dependency from a ready answer and from a refusal, and drops the error text', () => {
  const ready = { success: true, data: { database: { status: 'up', latencyMs: 3 } } };
  assert.deepEqual(healthChecks(ready), { database: { status: 'up', latencyMs: 3 } });

  const refused = {
    success: false,
    error: {
      details: {
        redis: { status: 'down', latencyMs: 2000, error: 'connect ECONNREFUSED 10.0.0.5' },
      },
    },
  };
  assert.deepEqual(healthChecks(refused), { redis: { status: 'down', latencyMs: 2000 } });

  assert.equal(healthChecks(null), null);
});
