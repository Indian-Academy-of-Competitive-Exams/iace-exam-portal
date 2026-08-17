import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), 'utf8');

const radio = read('src/components/ui/radio-group.tsx');
const checkbox = read('src/components/ui/checkbox.tsx');

describe('RadioGroup', () => {
  /**
   * The exam screen is the last place to be re-implementing something the
   * platform already does. Native radios sharing a name give arrow-key movement
   * between options, the one-of-many rule, and "radio button, 2 of 4" — all of
   * which a div with role="radio" has to earn back by hand.
   */
  it('uses native radios, like Checkbox uses a native box', () => {
    assert.match(radio, /type="radio"/);
    assert.match(radio, /name=\{group\.name\}/);
    assert.ok(!/role="radio"/.test(radio), 'no hand-built radio semantics');
  });

  /**
   * A fieldset+legend is what ties a question to its answers. Without it a
   * screen reader reads four options and nothing that says what they answer.
   */
  it('is a fieldset with a legend, so the options have a question', () => {
    assert.match(radio, /<fieldset/);
    assert.match(radio, /<legend/);
  });

  /**
   * Passing no `value` has to leave `checked` undefined rather than false —
   * `checked={false}` makes it a controlled input pinned to unchecked, so a
   * form that registers the inputs itself could never tick one.
   */
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
