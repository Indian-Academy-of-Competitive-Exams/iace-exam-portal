import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  headingFor,
  isMonthOutOfRange,
  isOutOfRange,
  isYearOutOfRange,
  monthGrid,
  nextFocusedDate,
  parseISODate,
  shiftMonth,
  toISODate,
  weeksOf,
  yearBlock,
  yearsOf,
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

/** Year navigation: reaching 1985 used to be ~490 clicks on the month chevron. */

describe('yearBlock', () => {
  /** Decades, not runs of twelve: a heading reading "2016 - 2027" tells a reader nothing. */
  it('is the decade, wherever in it you enter', () => {
    assert.deepEqual(yearBlock(2026), { start: 2020, end: 2029 });
    assert.deepEqual(yearBlock(2020), { start: 2020, end: 2029 });
    assert.deepEqual(yearBlock(2029), { start: 2020, end: 2029 });
    assert.deepEqual(yearBlock(2030), { start: 2030, end: 2039 });
  });

  it('fills the 3x4 grid by borrowing one year each side, as the day grid borrows days', () => {
    const years = yearsOf(yearBlock(1985));

    assert.equal(years.length, 12);
    assert.equal(years[0], 1979);
    assert.equal(years[1], 1980);
    assert.equal(years.at(-2), 1989);
    assert.equal(years.at(-1), 1990);
  });
});

describe('shiftMonth', () => {
  it('rolls the year at either boundary', () => {
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
    assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  });
});

describe('isMonthOutOfRange', () => {
  /** The whole point of greying a month: it must not hide days that ARE reachable. */
  it('keeps a month whose range only partly overlaps', () => {
    assert.equal(isMonthOutOfRange(2026, 7, undefined, '2026-08-21'), false);
    assert.equal(isMonthOutOfRange(2026, 7, '2026-08-21', undefined), false);
  });

  it('refuses a month entirely past the cap', () => {
    assert.equal(isMonthOutOfRange(2026, 8, undefined, '2026-08-21'), true);
    assert.equal(isMonthOutOfRange(2026, 6, '2026-08-01', undefined), true);
  });

  it('is inclusive on the boundary day', () => {
    assert.equal(isMonthOutOfRange(2026, 7, undefined, '2026-08-01'), false);
    assert.equal(isMonthOutOfRange(2026, 7, '2026-08-31', undefined), false);
  });
});

describe('isYearOutOfRange', () => {
  it('keeps the capped year itself, and refuses the ones beyond it', () => {
    assert.equal(isYearOutOfRange(2026, undefined, '2026-08-21'), false);
    assert.equal(isYearOutOfRange(2027, undefined, '2026-08-21'), true);
    assert.equal(isYearOutOfRange(1899, '1900-01-01', undefined), true);
    assert.equal(isYearOutOfRange(1900, '1900-01-01', undefined), false);
  });

  it('allows any year when unbounded, so a DOB field is not trapped in this decade', () => {
    assert.equal(isYearOutOfRange(1950), false);
  });
});

describe('nextFocusedDate', () => {
  it('steps a day with the arrows', () => {
    assert.equal(nextFocusedDate('2026-08-21', 'ArrowRight'), '2026-08-22');
    assert.equal(nextFocusedDate('2026-08-21', 'ArrowLeft'), '2026-08-20');
    assert.equal(nextFocusedDate('2026-08-21', 'ArrowDown'), '2026-08-28');
    assert.equal(nextFocusedDate('2026-08-21', 'ArrowUp'), '2026-08-14');
  });

  it('pages a month, and a year when shifted', () => {
    assert.equal(nextFocusedDate('2026-08-21', 'PageDown'), '2026-09-21');
    assert.equal(nextFocusedDate('2026-08-21', 'PageUp'), '2026-07-21');
    assert.equal(nextFocusedDate('2026-08-21', 'PageDown', true), '2027-08-21');
    assert.equal(nextFocusedDate('2026-08-21', 'PageUp', true), '2025-08-21');
  });

  /** Paging off the end of a short month must not skip into the one after it. */
  it('clamps to the last day when the target month is shorter', () => {
    assert.equal(nextFocusedDate('2026-01-31', 'PageDown'), '2026-02-28');
    assert.equal(nextFocusedDate('2024-02-29', 'PageUp', true), '2023-02-28');
  });

  it('moves to the ends of the focused week with Home and End', () => {
    // 21 Aug 2026 is a Friday, so its week runs Sunday 16th to Saturday 22nd.
    assert.equal(nextFocusedDate('2026-08-21', 'Home'), '2026-08-16');
    assert.equal(nextFocusedDate('2026-08-21', 'End'), '2026-08-22');
  });

  it('crosses a month boundary rather than clamping inside it', () => {
    assert.equal(nextFocusedDate('2026-08-01', 'Home'), '2026-07-26');
  });

  it('declines a key it does not own, so the popover still gets it', () => {
    for (const key of ['Enter', 'Escape', 'Tab', ' ', 'a']) {
      assert.equal(nextFocusedDate('2026-08-21', key), null);
    }
  });

  it('declines when the current focus is not a real date', () => {
    assert.equal(nextFocusedDate('', 'ArrowRight'), null);
    assert.equal(nextFocusedDate('2026-02-31', 'ArrowRight'), null);
  });
});

describe('headingFor', () => {
  it('names what is on show, so the heading says where a click would take you', () => {
    const view = { year: 2026, month: 7 };
    const block = yearBlock(view.year);

    assert.match(headingFor('day', view, block), /2026/);
    assert.equal(headingFor('month', view, block), '2026');
    assert.equal(headingFor('year', view, block), '2020 – 2029');
  });
});
