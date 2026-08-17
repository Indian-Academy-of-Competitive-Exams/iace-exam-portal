import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const table = read('src/components/ui/table.tsx');
const pagination = read('src/components/ui/pagination.tsx');

/** The class list of one component out of table.tsx. */
function classesOf(component: 'TableRow' | 'TableHead' | 'TableCell' | 'TableBody'): string {
  const start = table.indexOf(`const ${component} = `);
  assert.ok(start !== -1, `${component} should be declared in table.tsx`);
  const end = table.indexOf(`${component}.displayName`, start);
  return table.slice(start, end);
}

describe('table rules', () => {
  /**
   * A rule between rows separates them. A rule after the LAST row is the table
   * drawing its own bottom edge — and the table is not the last thing in the
   * box: Pagination sits underneath with a `border-t` of its own. The two landed
   * a dozen pixels apart at different widths, one spanning the table and one
   * inset by the pagination's padding, which reads as a rendering fault.
   */
  it('stop at the last row, because pagination draws the closing line', () => {
    assert.match(classesOf('TableBody'), /\[&>tr:last-child\]:border-b-0/);
    assert.match(pagination, /border-t border-border/, 'pagination is expected to close the box');
  });

  /**
   * `TableEmpty` never carried a bottom border while `TableCell` always did, so
   * the same table ended one way with rows in it and another way without. With
   * the rule on the row and the last one suppressed, both endings are the same.
   */
  it('are owned by the row, not repeated on every cell', () => {
    assert.match(classesOf('TableRow'), /border-b border-border/);
    for (const cell of ['TableHead', 'TableCell'] as const) {
      assert.ok(
        !classesOf(cell).includes('border-b'),
        `${cell} must not draw its own rule — the row decides, and only the row can tell it is last`,
      );
    }
  });

  /**
   * The suppression is scoped to `tbody`. The header's rule is the header/body
   * divider and has to survive — and the header row is the last child of its
   * own `thead`, so an unscoped `last:` would have taken it away.
   */
  it('keep the header divider', () => {
    // The header row IS the last child of its own thead, so an unscoped `last:`
    // would have removed the one rule the table cannot do without. Exactly one
    // last-child rule exists, and it is the body's.
    assert.equal(table.match(/tr:last-child/g)?.length, 1);
    assert.match(classesOf('TableBody'), /\[&>tr:last-child\]:border-b-0/);
  });
});
