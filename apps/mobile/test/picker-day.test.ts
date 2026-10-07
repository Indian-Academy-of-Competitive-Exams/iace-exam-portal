import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, valueOfDay } from '../src/lib/picker-day';

const DEVICE_ZONE = process.env.TZ;

afterEach(() => {
  if (DEVICE_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = DEVICE_ZONE;
});

/** The picker hands back the day it showed, at whatever hour, on the PHONE's clock. */
function pickedOn(zone: string, hour: number): string {
  process.env.TZ = zone;
  const shown = dayOf('1998-02-03');
  return valueOfDay(new Date(shown.getFullYear(), shown.getMonth(), shown.getDate(), hour));
}

test('a phone on the institute clock stores the day that was picked', () => {
  assert.equal(pickedOn('Asia/Kolkata', 0), '1998-02-03');
});

/** The defect this pins: local midnight east of India is still the day before on the institute's clock. */
test('a phone east of India stores the day that was picked', () => {
  assert.equal(pickedOn('Pacific/Auckland', 0), '1998-02-03');
});

test('a phone west of India stores the day that was picked', () => {
  assert.equal(pickedOn('America/Los_Angeles', 23), '1998-02-03');
});

test('a single-digit month and day keep their zeros', () => {
  process.env.TZ = 'Asia/Kolkata';

  assert.equal(valueOfDay(new Date(2001, 0, 9)), '2001-01-09');
});
