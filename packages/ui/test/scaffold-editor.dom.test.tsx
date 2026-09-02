import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScaffoldEditor, type ScaffoldRegion } from '../src/components/ui/scaffold-editor';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

const REGIONS: ScaffoldRegion[] = [
  { key: 'stem', label: 'Question:', html: '<p>What is 20% of 150?</p>' },
  { key: 'option:0', label: '(A)', html: '<p>25</p>' },
  { key: 'option:1', label: '(B)', html: '<p>30</p>' },
  { key: 'option:2', label: '(C)', html: '' },
  { key: 'answer', label: 'Answer:', html: '' },
];

function mount(props: Partial<React.ComponentProps<typeof ScaffoldEditor>> = {}) {
  const changes: ScaffoldRegion[][] = [];
  render(
    <TooltipProvider>
      <ScaffoldEditor
        aria-label="Question"
        regions={REGIONS}
        docKey="one"
        onChange={(regions) => changes.push(regions)}
        {...props}
      />
    </TooltipProvider>,
  );
  return { changes, box: screen.getByRole('textbox', { name: 'Question' }) };
}

const labels = () =>
  [...document.querySelectorAll('.scaffold-label')].map((node) => node.textContent);

const regionKeys = () =>
  [...document.querySelectorAll('[data-region]')].map((node) => node.getAttribute('data-region'));

/** What the typist wrote, without the labels, which are the node's own chrome. */
const bodies = () =>
  [...document.querySelectorAll('.scaffold-body')].map((node) => node.textContent?.trim() ?? '');

/** Enter moves slot to slot, so the caret gets where it is going the way a typist sends it. */
function down(box: HTMLElement, times: number): void {
  for (let step = 0; step < times; step += 1) fireEvent.keyDown(box, { key: 'Enter' });
}

const FIGURE = '<img src="https://iace.invalid/chart.png" data-key="questions/images/chart.png">';

/** What Ctrl+A leaves behind, without depending on the browser's own select-all. */
function selectWholeDocument(): void {
  const range = document.createRange();
  range.selectNodeContents(screen.getByRole('textbox', { name: 'Question' }));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('the scaffold labels', () => {
  it('are drawn for every slot, in order', () => {
    mount();

    assert.deepEqual(labels(), ['Question:', '(A)', '(B)', '(C)', 'Answer:']);
  });

  it('sit outside the editable content, so nothing can type over or delete one', () => {
    mount();

    for (const label of document.querySelectorAll('.scaffold-label')) {
      assert.equal(label.getAttribute('contenteditable'), 'false');
    }
  });

  it('are not part of what the box reports, so a label can never reach a question', () => {
    mount();

    const stem = document.querySelector('[data-region="stem"] .scaffold-body');
    assert.equal(stem?.textContent, 'What is 20% of 150?');

    // Every label sits outside every body, which is what keeps it out of the html.
    for (const label of document.querySelectorAll('.scaffold-label')) {
      assert.equal(label.closest('.scaffold-body'), null);
    }
  });
});

describe('a figure in a slot', () => {
  const withFigure = () =>
    mount({
      onUploadImage: async () => ({ key: 'k', url: 'https://iace.invalid/chart.png' }),
      regions: [
        { key: 'stem', label: 'Question:', html: '<p>Which curve is it?</p>' },
        { key: 'option:0', label: '(A)', html: FIGURE },
        { key: 'option:1', label: '(B)', html: '<p>30</p>' },
        { key: 'option:2', label: '(C)', html: '<p>35</p>' },
        { key: 'answer', label: 'Answer:', html: '' },
      ],
    });

  /** The reported gap: a pasted figure could be put in and never taken back out. */
  it('carries a control that removes it', () => {
    const { box } = withFigure();

    const remove = screen.getByRole('button', { name: 'Remove image' });
    fireEvent.mouseDown(remove);

    assert.equal(box.querySelectorAll('img').length, 0);
    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'option:2', 'answer']);
  });

  it('carries a corner to drag, so a figure is not stuck at whatever size it arrived', () => {
    const { box } = withFigure();

    assert.equal(box.querySelectorAll('.rich-figure-handle').length, 1);
  });

  /** The failure this prevents: no TEXT read as blank, so Backspace took the slot and the figure. */
  it('is content, so the slot holding it is not an empty slot', () => {
    const { box } = withFigure();
    act(() => {
      down(box, 1);
      fireEvent.keyDown(box, { key: 'Backspace' });
    });

    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'option:2', 'answer']);
    assert.equal(box.querySelectorAll('img').length, 1);
  });
});

describe('a slot that says what it is for', () => {
  const withHint = () =>
    mount({
      regions: [
        { key: 'stem', label: 'Question:', html: '<p>Which is it?</p>' },
        { key: 'option:0', label: '(A)', html: '<p>25</p>' },
        { key: 'option:1', label: '(B)', html: '<p>30</p>' },
        { key: 'answer', label: 'Answer:', html: '', hint: 'The option, not its text' },
        { key: 'filled', label: 'Filled:', html: '<p>B</p>', hint: 'Never seen' },
        { key: 'solution', label: 'Explanation:', html: '' },
      ],
    });

  it('shows the hint while the slot is empty', () => {
    withHint();

    const answer = document.querySelector('[data-region="answer"] p');
    assert.equal(answer?.getAttribute('data-placeholder'), 'The option, not its text');
  });

  /** A slot with no hint gets none: the rest of the box is not a row of instructions. */
  it('says nothing where there is nothing to say', () => {
    withHint();

    assert.equal(document.querySelector('[data-region="solution"] p.is-empty'), null);
    assert.equal(document.querySelector('[data-region="stem"] p.is-empty'), null);
  });

  it('holds its tongue once the slot says something of its own', () => {
    withHint();

    assert.equal(document.querySelector('[data-region="filled"] p.is-empty'), null);
  });
});

describe('a table in a slot', () => {
  /** The reported gap: a table's controls lived in one toolbar menu, so a second table had none. */
  it('carries its own controls, without a menu to find first', () => {
    const { box } = mount({
      regions: [
        {
          key: 'stem',
          label: 'Question:',
          html: '<table><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
        },
        { key: 'option:0', label: '(A)', html: '<p>25</p>' },
        { key: 'option:1', label: '(B)', html: '<p>30</p>' },
        { key: 'answer', label: 'Answer:', html: '' },
      ],
    });
    assert.equal(box.querySelectorAll('table').length, 1);

    for (const name of ['Add a row below', 'Add a column to the right', 'Delete this row']) {
      assert.ok(screen.getByRole('button', { name }));
    }

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Remove table' }));

    assert.equal(box.querySelectorAll('table').length, 0);
    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'answer']);
  });

  /** One bar per table, so the second one is reachable without moving the caret to the first. */
  it('gives each table its own bar', () => {
    mount({
      regions: [
        {
          key: 'stem',
          label: 'Question:',
          html:
            '<table><tbody><tr><td><p>1</p></td></tr></tbody></table>' +
            '<p>and</p>' +
            '<table><tbody><tr><td><p>2</p></td></tr></tbody></table>',
        },
        { key: 'option:0', label: '(A)', html: '<p>25</p>' },
        { key: 'option:1', label: '(B)', html: '<p>30</p>' },
        { key: 'answer', label: 'Answer:', html: '' },
      ],
    });

    assert.equal(document.querySelectorAll('.rich-table-tools').length, 2);
    assert.equal(screen.getAllByRole('button', { name: 'Remove table' }).length, 2);
  });
});

describe('the keyboard', () => {
  /** How many options there are is the header's, so no key in the box may add or drop one. */
  it('walks the slots without ever changing how many there are', () => {
    const { box } = mount();
    act(() => {
      down(box, 6);
      fireEvent.keyDown(box, { key: 'Backspace' });
    });

    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'option:2', 'answer']);
  });

  /** The failure this closes: Ctrl+A then Backspace took every slot with it, unrecoverably. */
  it('empties what a selection covers and leaves the slots standing', () => {
    const { box } = mount();
    act(() => {
      fireEvent.keyDown(box, { key: 'a', ctrlKey: true });
      selectWholeDocument();
      fireEvent.keyDown(box, { key: 'Backspace' });
    });

    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'option:2', 'answer']);
    assert.equal(bodies().join(''), '');
  });

  /** Hindi and Telugu are typed through an input method, whose Enter and arrows come first. */
  it('keeps out of the way while an input method is composing', () => {
    let saved = 0;
    let cycled = 0;
    const { box } = mount({ onSave: () => (saved += 1), onCycleLanguage: () => (cycled += 1) });

    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(box, { key: 'l', code: 'KeyL', altKey: true, isComposing: true });

    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'option:2', 'answer']);
    assert.equal(saved, 0);
    assert.equal(cycled, 0);
  });

  it('saves on Ctrl+Enter rather than typing a line', () => {
    let saved = 0;
    const { box } = mount({ onSave: () => (saved += 1) });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    assert.equal(saved, 1);
  });

  it('cycles the language on Alt+L, the one action that is not Up, Down or Enter', () => {
    let cycled = 0;
    const { box } = mount({ onCycleLanguage: () => (cycled += 1) });
    fireEvent.keyDown(box, { key: 'l', code: 'KeyL', altKey: true });

    assert.equal(cycled, 1);
  });

  /** The failure this prevents: a Mac sends "¬" for Option+L, and the shortcut never fired. */
  it('cycles it on a Mac too, where the key is not the letter', () => {
    let cycled = 0;
    const { box } = mount({ onCycleLanguage: () => (cycled += 1) });
    fireEvent.keyDown(box, { key: '\u00ac', code: 'KeyL', altKey: true });

    assert.equal(cycled, 1);
  });
});
