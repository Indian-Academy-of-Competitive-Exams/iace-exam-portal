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
  /** Pagination sits under the table with a `border-t` of its own. */
  it('stop at the last row, because pagination draws the closing line', () => {
    assert.match(classesOf('TableBody'), /\[&>tr:last-child\]:border-b-0/);
    assert.match(pagination, /border-t border-border/, 'pagination is expected to close the box');
  });

  /** On the cells, an empty table and a populated one ended differently. */
  it('are owned by the row, not repeated on every cell', () => {
    assert.match(classesOf('TableRow'), /border-b border-border/);
    for (const cell of ['TableHead', 'TableCell'] as const) {
      assert.ok(
        !classesOf(cell).includes('border-b'),
        `${cell} must not draw its own rule — the row decides, and only the row can tell it is last`,
      );
    }
  });

  /** The header row is the last child of its own `thead`, so `last:` must be scoped. */
  it('keep the header divider', () => {
    // Exactly one last-child rule exists, and it is the body's.
    assert.equal(table.match(/tr:last-child/g)?.length, 1);
    assert.match(classesOf('TableBody'), /\[&>tr:last-child\]:border-b-0/);
  });
});
