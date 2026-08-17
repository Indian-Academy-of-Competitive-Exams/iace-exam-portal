import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const radio = read('src/components/ui/radio-group.tsx');
const checkbox = read('src/components/ui/checkbox.tsx');

describe('RadioGroup styling', () => {
  /** Same row height as Checkbox: the two sit in the same forms. */
  it('matches the checkbox row', () => {
    for (const shape of ['px-2 py-1.5', 'accent-primary', 'mt-0.5 size-4 shrink-0']) {
      assert.ok(radio.includes(shape), `radio should share "${shape}" with the checkbox`);
      assert.ok(checkbox.includes(shape), `checkbox is expected to still use "${shape}"`);
    }
  });
});
