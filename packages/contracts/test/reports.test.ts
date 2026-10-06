import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REPORT_KEYS,
  REPORT_PERIODS,
  reportFieldsMissing,
  reportPeriodOf,
  reportQuerySchema,
} from '../src/reports';

describe('reportPeriodOf', () => {
  it('runs a week Monday to Sunday, whichever day it is asked on', () => {
    const week = { from: '2026-10-05', to: '2026-10-11' };

    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.THIS_WEEK, '2026-10-05'), week);
    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.THIS_WEEK, '2026-10-08'), week);
    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.THIS_WEEK, '2026-10-11'), week);
  });

  it('takes last week back across a month and a year', () => {
    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.LAST_WEEK, '2027-01-01'), {
      from: '2026-12-21',
      to: '2026-12-27',
    });
  });

  it('ends a month on its own last day, a leap February included', () => {
    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.THIS_MONTH, '2028-02-10'), {
      from: '2028-02-01',
      to: '2028-02-29',
    });
    assert.deepEqual(reportPeriodOf(REPORT_PERIODS.LAST_MONTH, '2027-01-15'), {
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });
});

describe('reportFieldsMissing', () => {
  it('names the query keys a report cannot be built without', () => {
    assert.deepEqual(reportFieldsMissing(REPORT_KEYS.TEST_MERIT, {}), ['testId']);
    assert.deepEqual(
      reportFieldsMissing(REPORT_KEYS.TEST_MERIT, {
        testId: '0198f0a0-0000-7000-8000-000000000001',
      }),
      [],
    );
  });
});

describe('reportQuerySchema', () => {
  it('refuses a period that ends before it starts', () => {
    const parsed = reportQuerySchema.safeParse({ from: '2026-10-08', to: '2026-10-01' });

    assert.equal(parsed.success, false);
  });

  it('reads top off the query string as a number', () => {
    assert.equal(reportQuerySchema.parse({ top: '25' }).top, 25);
  });
});
