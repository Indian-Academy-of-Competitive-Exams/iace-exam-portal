import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const radio = read('src/components/ui/radio-group.tsx');
const checkbox = read('src/components/ui/checkbox.tsx');

describe('RadioGroup', () => {
  /** Native radios give arrow keys, the one-of-many rule and "radio button, 2 of 4". */
  it('uses native radios, like Checkbox uses a native box', () => {
    assert.match(radio, /type="radio"/);
    assert.match(radio, /name=\{group\.name\}/);
    assert.ok(!/role="radio"/.test(radio), 'no hand-built radio semantics');
  });

  /** Without a fieldset+legend a screen reader reads four options and no question. */
  it('is a fieldset with a legend, so the options have a question', () => {
    assert.match(radio, /<fieldset/);
    assert.match(radio, /<legend/);
  });

  /** `checked={false}` would pin it unchecked, so a registering form could never tick it. */
  it('stays uncontrolled when the group holds no value', () => {
    assert.match(
      radio,
      /checked=\{group\.value === undefined \? undefined : group\.value === value\}/,
    );
  });

  /** Same row height as Checkbox: the two sit in the same forms. */
  it('matches the checkbox row', () => {
    for (const shape of ['px-2 py-1.5', 'accent-primary', 'mt-0.5 size-4 shrink-0']) {
      assert.ok(radio.includes(shape), `radio should share "${shape}" with the checkbox`);
      assert.ok(checkbox.includes(shape), `checkbox is expected to still use "${shape}"`);
    }
  });
});
