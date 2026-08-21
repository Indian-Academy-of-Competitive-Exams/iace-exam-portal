import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isOutOfRange,
  monthGrid,
  parseISODate,
  toISODate,
  weeksOf,
} from '../src/components/ui/date-picker';

/** The arithmetic, without a DOM. A calendar that is off by one is off by one everywhere. */

describe('toISODate', () => {
  it('writes the wire format, zero-padded', () => {
    assert.equal(toISODate(2026, 0, 5), '2026-01-05');
    assert.equal(toISODate(2026, 11, 31), '2026-12-31');
  });

  /** Built from a local Date, a zone behind UTC serialises the 1st as the previous month's last. */
  it('is stable regardless of the machine timezone', () => {
    assert.equal(toISODate(2026, 2, 1), '2026-03-01');
    assert.equal(toISODate(2026, 2, 1).slice(8), '01');
  });
});

describe('parseISODate', () => {
  it('reads a well-formed date', () => {
    assert.deepEqual(parseISODate('2026-08-21'), { year: 2026, month: 7, day: 21 });
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    for (const bad of ['', null, undefined, '21-08-2026', '2026-8-21', 'today']) {
      assert.equal(parseISODate(bad), null);
    }
  });

  /** 2026-02-31 would otherwise roll silently into March and store a date nobody picked. */
  it('refuses a day that month does not have', () => {
    assert.equal(parseISODate('2026-02-31'), null);
    assert.equal(parseISODate('2026-04-31'), null);
    assert.deepEqual(parseISODate('2024-02-29'), { year: 2024, month: 1, day: 29 });
    assert.equal(parseISODate('2026-02-29'), null);
  });
});

describe('monthGrid', () => {
  it('always draws six weeks, so paging never resizes the popover', () => {
    for (const [year, month] of [
      [2026, 1],
      [2026, 7],
      [2024, 1],
    ] as const) {
      assert.equal(monthGrid(year, month).length, 42);
    }
  });

  it('starts on the Sunday on or before the first of the month', () => {
    // 1 Aug 2026 is a Saturday, so the grid opens on 26 July.
    assert.equal(monthGrid(2026, 7)[0]?.iso, '2026-07-26');
  });

  it('marks the borrowed days at each end as outside the month', () => {
    const cells = monthGrid(2026, 7);

    assert.equal(cells[0]?.inMonth, false);
    assert.equal(cells.filter((cell) => cell.inMonth).length, 31);
    assert.equal(cells.at(-1)?.inMonth, false);
  });

  it('runs consecutively, with no day skipped or repeated', () => {
    const cells = monthGrid(2026, 1);
    const seen = new Set(cells.map((cell) => cell.iso));

    assert.equal(seen.size, 42);
    assert.equal(cells[0]?.iso, '2026-02-01');
  });

  it('handles a leap February', () => {
    const cells = monthGrid(2024, 1).filter((cell) => cell.inMonth);

    assert.equal(cells.length, 29);
    assert.equal(cells.at(-1)?.iso, '2024-02-29');
  });
});

describe('isOutOfRange', () => {
  it('is inclusive at both ends', () => {
    assert.equal(isOutOfRange('2026-08-21', '2026-08-21', '2026-08-21'), false);
  });

  it('refuses either side', () => {
    assert.equal(isOutOfRange('2026-08-20', '2026-08-21', undefined), true);
    assert.equal(isOutOfRange('2026-08-22', undefined, '2026-08-21'), true);
  });

  it('allows anything when neither bound is given', () => {
    assert.equal(isOutOfRange('1999-01-01'), false);
  });
});

describe('weeksOf', () => {
  /** The table needs real rows: a flat run of 42 cells under one <tr> is not a grid. */
  it('splits the run into six rows of seven, in order', () => {
    const cells = monthGrid(2026, 7);
    const weeks = weeksOf(cells);

    assert.equal(weeks.length, 6);
    assert.ok(weeks.every((week) => week.length === 7));
    assert.equal(weeks[0]?.[0]?.iso, cells[0]?.iso);
    assert.equal(weeks[5]?.[6]?.iso, cells[41]?.iso);
  });
});
