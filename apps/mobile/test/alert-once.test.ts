import test from 'node:test';
import assert from 'node:assert/strict';
import { alertOnce } from '../src/lib/alert-once';

const OFFLINE = 'Could not connect. Check your connection and try again.';

function rig() {
  let clock = 0;
  const raised: { message: string; dismiss: () => void }[] = [];
  const notify = alertOnce(
    (message, dismiss) => raised.push({ message, dismiss }),
    () => clock,
  );
  return {
    raised,
    notify,
    wait: (ms: number) => {
      clock += ms;
    },
  };
}

/** The defect this pins: Home's four reads each raised the same alert, stacked seconds apart. */
test('reads that failed together raise one alert', () => {
  const { raised, notify, wait } = rig();

  notify(OFFLINE);
  wait(400);
  notify(OFFLINE);
  wait(900);
  notify(OFFLINE);
  notify(OFFLINE);

  assert.deepEqual(
    raised.map((one) => one.message),
    [OFFLINE],
  );
});

test('a different message still shows beside it', () => {
  const { raised, notify } = rig();

  notify(OFFLINE);
  notify('That file is too large.');

  assert.equal(raised.length, 2);
});

test('a failure after the alert was dismissed is said again', () => {
  const { raised, notify, wait } = rig();

  notify(OFFLINE);
  raised[0]?.dismiss();
  wait(1_000);
  notify(OFFLINE);

  assert.equal(raised.length, 2);
});

test('the same failure a minute later shows again, even if no dismissal was ever reported', () => {
  const { raised, notify, wait } = rig();

  notify(OFFLINE);
  wait(60_000);
  notify(OFFLINE);

  assert.equal(raised.length, 2);
});
