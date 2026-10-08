import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { ScaffoldEditor, type ScaffoldRegion } from '../src/components/ui/scaffold-editor';
import { Toaster, toast } from '../src/components/ui/toast';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);
afterEach(() => toast.clear());

const REGIONS: ScaffoldRegion[] = [
  { key: 'stem', label: 'Question:', html: '<p>What is 20% of 150?</p>' },
  { key: 'option:0', label: '(A)', html: '<p>25</p>' },
  { key: 'option:1', label: '(B)', html: '<p>30</p>' },
  { key: 'option:2', label: '(C)', html: '' },
  { key: 'answer', label: 'Answer:', html: '' },
];

type BoxProps = Partial<React.ComponentProps<typeof ScaffoldEditor>>;

function mount(props: BoxProps = {}) {
  const changes: ScaffoldRegion[][] = [];
  const draw = (next: BoxProps) => (
    <TooltipProvider>
      <Toaster />
      <ScaffoldEditor
        aria-label="Question"
        regions={REGIONS}
        docKey="one"
        onChange={(regions) => changes.push(regions)}
        {...props}
        {...next}
      />
    </TooltipProvider>
  );
  const view = render(draw({}));
  return {
    changes,
    box: screen.getByRole('textbox', { name: 'Question' }),
    /** Another question or another language, the way the page hands one over. */
    load: (docKey: string, regions: ScaffoldRegion[]) => view.rerender(draw({ docKey, regions })),
  };
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

const upload = async () => ({ key: 'k', url: 'https://iace.invalid/chart.png' });

const editorOf = (box: HTMLElement) => (box as HTMLElement & { editor: Editor }).editor;

/** Where the caret is: which slot, and whether it is somewhere text goes. */
function caret(box: HTMLElement) {
  const { $from } = editorOf(box).state.selection;
  return { slot: $from.index(0), inText: $from.parent.isTextblock };
}

/** What a slot holds, block by block, in the order it is drawn. */
function blocksOf(key: string): string[] {
  const body = document.querySelector(`[data-region="${key}"] .scaffold-body`);
  return [...(body?.children ?? [])].map((node) => (node.matches('p') ? 'line' : 'figure'));
}

const CHART = new File(['x'], 'chart.png', { type: 'image/png' });

/** The toolbar's own way in, so the figure arrives the way a typist adds one. */
function chooseFigure(): void {
  const input = document.querySelector('input[type="file"]');
  assert.ok(input);
  fireEvent.change(input, { target: { files: [CHART] } });
}

async function addFigure(): Promise<void> {
  chooseFigure();
  await screen.findByRole('button', { name: 'Remove image' });
}

/** jsdom lays nothing out, so the point a drop lands on is told to it: the first line of a slot. */
function dropOn(box: HTMLElement, key: string, file: File): boolean {
  const line = document.querySelector(`[data-region="${key}"] p`);
  Object.defineProperty(document, 'elementFromPoint', { value: () => line, configurable: true });
  try {
    return fireEvent.drop(box, {
      dataTransfer: {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        getData: () => '',
      },
    });
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
}

/** What Ctrl+A leaves behind, without depending on the browser's own select-all. */
function selectWholeDocument(): void {
  const range = document.createRange();
  range.selectNodeContents(screen.getByRole('textbox', { name: 'Question' }));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('a box that is switched off', () => {
  /** The failure this prevents: a question held by somebody else that still takes typing and still offers its tools. */
  it('shows the question, takes no typing and offers no tools', () => {
    const { box } = mount({ disabled: true, toolbarEnd: <button type="button">Language</button> });

    assert.deepEqual(bodies().slice(0, 2), ['What is 20% of 150?', '25']);
    assert.equal(box.getAttribute('contenteditable'), 'false');
    assert.equal(screen.queryAllByRole('button').length, 0);
  });

  it('takes typing again once it is switched back on', () => {
    const { box } = mount();

    assert.equal(box.getAttribute('contenteditable'), 'true');
    assert.ok(screen.queryAllByRole('button').length > 0);
  });
});

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
      onUploadImage: upload,
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

  /** The reported gap: a figure that ended its slot left nowhere beneath it to type. */
  it('is followed by a line, so text can go beneath it', () => {
    withFigure();

    assert.deepEqual(blocksOf('option:0'), ['figure', 'line']);
  });

  /** The failure this prevents: a question nobody touched, marked unsaved for being opened. */
  it('gets that line without the box reporting an edit', () => {
    const { changes } = withFigure();

    assert.deepEqual(changes, []);
  });

  it('keeps that line out of what the box reports, because nobody wrote it', () => {
    const { box, changes } = withFigure();
    act(() => {
      editorOf(box).commands.insertContent('!');
    });

    assert.match(changes.at(-1)?.[1]?.html ?? '', /^<img[^>]*>$/);
  });

  /** Backspace on the empty line reaches the figure; the way back under it is not lost for that. */
  it('has that line back the moment it is deleted', () => {
    const { box } = withFigure();
    act(() => {
      down(box, 1);
      fireEvent.keyDown(box, { key: 'Backspace' });
    });

    assert.deepEqual(blocksOf('option:0'), ['figure', 'line']);
    assert.deepEqual(caret(box), { slot: 1, inText: false });
  });

  /** The failure this prevents: Enter into a slot that opens with a figure put the caret where no text goes. */
  it('hands Enter on to the line beneath it', () => {
    const { box } = withFigure();
    act(() => down(box, 1));

    assert.deepEqual(caret(box), { slot: 1, inText: true });
  });

  /** The reported gap: the caret left for the next slot, and nothing brought it back under the figure. */
  it('leaves the caret on the line beneath it when it is added', async () => {
    const { box } = mount({ onUploadImage: upload });
    act(() => down(box, 3));
    await addFigure();

    assert.deepEqual(blocksOf('option:2'), ['figure', 'line']);
    assert.deepEqual(caret(box), { slot: 3, inText: true });
  });

  it('makes no line of its own when text already follows it', async () => {
    const { box } = mount({ onUploadImage: upload });
    await addFigure();

    assert.deepEqual(blocksOf('stem'), ['figure', 'line']);
    assert.equal(
      document.querySelector('[data-region="stem"] p')?.textContent,
      'What is 20% of 150?',
    );
    assert.deepEqual(caret(box), { slot: 0, inText: true });
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

/** The text of every node under `selector` in one slot, in the order it is drawn. */
const textsOf = (key: string, selector: string) =>
  [...document.querySelectorAll(`[data-region="${key}"] ${selector}`)].map(
    (node) => node.textContent,
  );

describe('Enter where a block has an Enter of its own', () => {
  /** The failure this prevents: the toolbar offered a list nobody could add a second item to. */
  it('starts the next bullet, and only leaves the slot once the list is left', () => {
    const { box } = mount();
    act(() => down(box, 3));
    act(() => {
      fireEvent.click(screen.getByLabelText('Bullet list'));
      editorOf(box).commands.insertContent('first');
      fireEvent.keyDown(box, { key: 'Enter' });
      editorOf(box).commands.insertContent('second');
    });

    assert.deepEqual(textsOf('option:2', 'li'), ['first', 'second']);
    assert.equal(caret(box).slot, 3);

    // An empty bullet's Enter ends the list, and the one after that is a plain line's again.
    act(() => down(box, 2));
    assert.deepEqual(textsOf('option:2', 'li'), ['first', 'second']);
    assert.equal(caret(box).slot, 3);

    act(() => down(box, 1));
    assert.equal(caret(box).slot, 4);
  });

  it('adds a line inside a table cell', () => {
    const { box } = mount({
      regions: [
        {
          key: 'stem',
          label: 'Question:',
          html: '<table><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
        },
        { key: 'option:0', label: '(A)', html: '<p>25</p>' },
        { key: 'answer', label: 'Answer:', html: '' },
      ],
    });
    act(() => {
      editorOf(box).commands.insertContent('x');
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    assert.deepEqual(textsOf('stem', 'td:first-child p'), ['x', '1']);
    assert.equal(caret(box).slot, 0);
  });

  it('still moves on from a plain line', () => {
    const { box } = mount();
    act(() => down(box, 1));

    assert.equal(caret(box).slot, 1);
    assert.deepEqual(textsOf('stem', 'p'), ['What is 20% of 150?']);
  });
});

/** ProseMirror calls this prop on every typed character; jsdom raises no input event of its own. */
function type(box: HTMLElement, text: string): void {
  const { view } = editorOf(box);
  for (const char of text) {
    const { from, to } = view.state.selection;
    const plain = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, plain),
    );
    if (!handled) view.dispatch(plain());
  }
}

/** The bank keeps none of these, so a mark the box drew would be gone after the save. */
describe('formatting the bank does not store', () => {
  const typedInOptionC = (text: string) => {
    const { box, changes } = mount();
    act(() => {
      down(box, 3);
      type(box, text);
    });
    return changes.at(-1)?.[3]?.html;
  };

  /** The failure this prevents: "> 5" became a quote, and the option was saved as "5". */
  it('leaves a leading "> " as the sign it is', () => {
    assert.equal(typedInOptionC('> 5'), '<p>&gt; 5</p>');
  });

  it('leaves tildes, back-ticks and a web address as they were typed', () => {
    assert.equal(
      typedInOptionC('~~wrong~~ `x` iace.co.in now'),
      '<p>~~wrong~~ `x` iace.co.in now</p>',
    );
  });

  it('leaves a line of back-ticks, a hash and dashes as text', () => {
    assert.equal(typedInOptionC('``` '), '<p>``` </p>');
    cleanup();
    assert.equal(typedInOptionC('# 1'), '<p># 1</p>');
    cleanup();
    assert.equal(typedInOptionC('--- '), '<p>--- </p>');
  });

  /** A tag the box no longer draws must cost its markup and never its words, as it does at the save. */
  it('keeps the words of markup it does not draw', () => {
    mount({
      regions: [
        { key: 'stem', label: 'Question:', html: '<blockquote><p>&gt; 5</p></blockquote>' },
        {
          key: 'option:0',
          label: '(A)',
          html: '<p><s>wrong</s> <code>x</code> <a href="https://iace.invalid">here</a></p>',
        },
        { key: 'answer', label: 'Answer:', html: '<h2>B</h2>' },
      ],
    });

    assert.deepEqual(bodies(), ['> 5', 'wrong x here', 'B']);
  });
});

describe('a selection that runs from one slot into another', () => {
  const WORDS: ScaffoldRegion[] = [
    { key: 'stem', label: 'Question:', html: '<p>What is 20% of 150?</p>' },
    { key: 'option:0', label: '(A)', html: '<p>twenty five</p>' },
    { key: 'option:1', label: '(B)', html: '<p>thirty</p>' },
    { key: 'answer', label: 'Answer:', html: '<p>B</p>' },
  ];

  /** Where a word starts in the document, so a selection is made the way a drag would make it. */
  function before(box: HTMLElement, word: string): number {
    let found = -1;
    editorOf(box).state.doc.descendants((node, pos) => {
      const at = node.text?.indexOf(word) ?? -1;
      if (at >= 0 && found < 0) found = pos + at;
    });
    assert.ok(found >= 0, `"${word}" is in the box`);
    return found;
  }

  function selected(from: string, to: string) {
    const { box } = mount({ regions: WORDS });
    act(() => {
      editorOf(box).commands.setTextSelection({ from: before(box, from), to: before(box, to) });
    });
    return box;
  }

  /** The failure this prevents: Backspace took every word of both slots, selected or not. */
  it('loses to Backspace only the words it covers', () => {
    const box = selected('20%', 'five');
    fireEvent.keyDown(box, { key: 'Backspace' });

    assert.deepEqual(bodies(), ['What is', 'five', 'thirty', 'B']);
    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'answer']);
    assert.deepEqual(caret(box), { slot: 0, inText: true });
  });

  it('empties a slot it covers whole, and keeps the rest of the last one', () => {
    const box = selected('20%', 'rty');
    fireEvent.keyDown(box, { key: 'Delete' });

    assert.deepEqual(bodies(), ['What is', '', 'rty', 'B']);
    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'answer']);
  });

  /** The failure this prevents: Cut copied the words and left every one of them in the box. */
  it('is cut: the words leave the box and are on the clipboard', () => {
    const box = selected('20%', 'five');
    const clipboard = new Map<string, string>();
    fireEvent.cut(box, {
      clipboardData: {
        clearData: () => clipboard.clear(),
        setData: (type: string, value: string) => clipboard.set(type, value),
      },
    });

    assert.deepEqual(bodies(), ['What is', 'five', 'thirty', 'B']);
    assert.deepEqual(regionKeys(), ['stem', 'option:0', 'option:1', 'answer']);
    assert.match(clipboard.get('text/plain') ?? '', /20% of 150\?\s+twenty $/);
  });

  it('gives nothing up to a cut while the box is switched off', () => {
    const { box } = mount({ regions: WORDS, disabled: true });
    act(() => {
      editorOf(box).commands.setTextSelection({
        from: before(box, '20%'),
        to: before(box, 'five'),
      });
      fireEvent.cut(box, { clipboardData: { clearData: () => {}, setData: () => {} } });
    });

    assert.deepEqual(bodies(), ['What is 20% of 150?', 'twenty five', 'thirty', 'B']);
  });

  it('leaves a cut inside one slot to the editor', () => {
    const box = selected('20%', 'of');
    const clipboard = new Map<string, string>();
    fireEvent.cut(box, {
      clipboardData: {
        clearData: () => clipboard.clear(),
        setData: (type: string, value: string) => clipboard.set(type, value),
      },
    });

    assert.deepEqual(bodies(), ['What is of 150?', 'twenty five', 'thirty', 'B']);
    assert.equal(clipboard.get('text/plain'), '20% ');
  });
});

const BLANK = REGIONS.map((region) => ({ ...region, html: '' }));

describe('loading another language or the next question', () => {
  function loaded() {
    const { box, changes, load } = mount();
    act(() => type(box, 'English '));
    load('one:hi', BLANK);
    changes.length = 0;
    return { box, changes };
  }

  /** The failure this prevents: Undo brought the English text into the Hindi slots, to be saved as Hindi. */
  it('is not a step Undo takes back', () => {
    const { box, changes } = loaded();
    act(() => {
      editorOf(box).commands.undo();
      editorOf(box).commands.undo();
    });

    assert.equal(bodies().join(''), '');
    assert.deepEqual(changes, []);
  });

  it('leaves Undo to take back what was typed since', () => {
    const { box } = loaded();
    act(() => type(box, 'namaste'));
    assert.equal(bodies()[0], 'namaste');

    act(() => {
      editorOf(box).commands.undo();
    });

    assert.equal(bodies().join(''), '');
  });
});

describe('a picture that is still uploading', () => {
  /** An upload the test finishes when it chooses to, the way a large picture arrives late. */
  function slowUpload() {
    let arrive = () => {};
    const upload = () =>
      new Promise<{ key: string; url: string }>((resolve) => {
        arrive = () => resolve({ key: 'k', url: 'https://iace.invalid/chart.png' });
      });
    return { upload, arrive: () => act(async () => arrive()) };
  }

  /** The failure this prevents: it landed wherever the caret had got to by the time it arrived. */
  it('lands where it was chosen, and leaves the caret with the typist who moved on', async () => {
    const slow = slowUpload();
    const { box } = mount({ onUploadImage: slow.upload });
    act(() => down(box, 2));
    chooseFigure();
    act(() => {
      down(box, 1);
      type(box, 'typed meanwhile');
    });
    await slow.arrive();
    await screen.findByRole('button', { name: 'Remove image' });

    assert.deepEqual(blocksOf('option:1'), ['figure', 'line']);
    assert.deepEqual(blocksOf('option:2'), ['line']);
    assert.equal(bodies()[3], 'typed meanwhile');
    assert.deepEqual(caret(box), { slot: 3, inText: true });
  });

  it('lands where it was dropped, which is not where the caret is', async () => {
    const { box } = mount({ onUploadImage: upload });
    act(() => down(box, 2));
    const left = dropOn(box, 'answer', CHART);
    await screen.findByRole('button', { name: 'Remove image' });

    assert.equal(left, false, 'the box claims the drop');
    assert.deepEqual(blocksOf('answer'), ['figure', 'line']);
    assert.deepEqual(blocksOf('option:1'), ['line']);
  });

  /** The failure this prevents: it arrived in the other language, or in the next question's blank box. */
  it('is not added to a question loaded since, and says so', async () => {
    const slow = slowUpload();
    const { box, load } = mount({ onUploadImage: slow.upload });
    chooseFigure();
    load('two', BLANK);
    await slow.arrive();

    assert.ok(await screen.findByText(/was not added/));
    assert.equal(box.querySelectorAll('img').length, 0);
  });

  /** Only a load takes its place away: an edit beside it must never cost the typist the picture. */
  it('still lands in its slot when the words around it are deleted meanwhile', async () => {
    const slow = slowUpload();
    const { box } = mount({ onUploadImage: slow.upload });
    act(() => {
      editorOf(box).commands.setTextSelection(5);
    });
    chooseFigure();
    act(() => {
      editorOf(box).commands.selectAll();
      fireEvent.keyDown(box, { key: 'Backspace' });
    });
    await slow.arrive();
    await screen.findByRole('button', { name: 'Remove image' });

    assert.equal(document.querySelectorAll('[data-region="stem"] img').length, 1);
    assert.equal(box.querySelectorAll('img').length, 1);
  });

  /** The failure this prevents: the first to arrive took the blank line, and the rest had nowhere to go. */
  it('is joined by the others pasted with it onto one blank line', async () => {
    const { box } = mount({ onUploadImage: upload });
    act(() => down(box, 3));
    const pasted = ['one.png', 'two.png', 'three.png'].map((name) => {
      const file = new File(['x'], name, { type: 'image/png' });
      return { kind: 'file', type: file.type, getAsFile: () => file };
    });
    fireEvent.paste(box, { clipboardData: { items: pasted, getData: () => '' } });
    await screen.findAllByRole('button', { name: 'Remove image' });

    assert.deepEqual(blocksOf('option:2'), ['figure', 'figure', 'figure', 'line']);
    assert.deepEqual(caret(box), { slot: 3, inText: true });
  });
});

describe('a file the box cannot take', () => {
  /** The failure this prevents: unclaimed, the browser opened the file in place of the page. */
  it('is refused out loud when it is dropped, rather than left to the browser', async () => {
    const { box, changes } = mount({ onUploadImage: upload });
    const paper = new File(['x'], 'paper.pdf', { type: 'application/pdf' });
    const left = dropOn(box, 'option:2', paper);

    assert.equal(left, false, 'the box claims the drop');
    assert.ok(await screen.findByText(/not accepted/));
    assert.deepEqual(changes, []);
  });
});

describe('a slot that holds a value', () => {
  const VALUED: ScaffoldRegion[] = [
    { key: 'stem', label: 'Question:', html: '<p>Which curve is it?</p>' },
    { key: 'answer', label: 'Answer', html: '', roman: true },
    { key: 'solution', label: 'Explanation', html: '' },
  ];

  /** The failure this prevents: the picture was read back as the answer "[image]", and saved. */
  it('takes no picture, and says it takes text only', async () => {
    const { box, changes } = mount({ onUploadImage: upload, regions: VALUED });
    act(() => down(box, 1));
    chooseFigure();

    assert.ok(await screen.findByText(/Answer takes text only/));
    assert.equal(box.querySelectorAll('img').length, 0);
    assert.deepEqual(changes, []);
  });

  it('leaves a slot of prose beside it to take one', async () => {
    const { box } = mount({ onUploadImage: upload, regions: VALUED });
    act(() => down(box, 2));
    await addFigure();

    assert.deepEqual(blocksOf('solution'), ['figure', 'line']);
  });

  it('still takes typing once it has refused a picture', async () => {
    const { box, changes } = mount({ onUploadImage: upload, regions: VALUED });
    act(() => down(box, 1));
    chooseFigure();
    await screen.findByText(/Answer takes text only/);
    act(() => type(box, 'B'));

    assert.equal(changes.at(-1)?.[1]?.html, '<p>B</p>');
  });
});
