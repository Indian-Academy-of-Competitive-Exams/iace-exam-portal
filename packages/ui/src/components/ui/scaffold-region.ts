/**
 * One labelled slot. The label is the node's own chrome, rendered OUTSIDE the content hole,
 * so it is not in the document at all and cannot be typed over, split, selected or deleted.
 * `isolating` stops a join or a backspace merging two slots; the plugin below stops anything
 * else — a select-all and a delete included — from changing which slots there are.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { type Fragment, type Node as ProseNode } from '@tiptap/pm/model';
import { FIGURE_NODE } from './rich-text-image';
import { toast } from './toast';

export const REGION_NODE = 'scaffoldRegion';

/** An empty slot says what it is for, from the hint the region carries. */
function hints(state: EditorState): DecorationSet {
  const found: Decoration[] = [];

  state.doc.forEach((region, offset) => {
    const hint = text(region.attrs.hint);
    if (hint === '') return;
    const first = region.firstChild;
    if (!first?.isTextblock || first.content.size > 0) return;
    // +1 to step inside the region, where its first block begins.
    found.push(
      Decoration.node(offset + 1, offset + 1 + first.nodeSize, {
        class: 'is-empty',
        'data-placeholder': hint,
      }),
    );
  });

  return DecorationSet.create(state.doc, found);
}

/** How a slot wears its label: none at all, a seat in a run, or a word standing for the slot. */
export const REGION_KIND = {
  PLAIN: 'plain',
  SEAT: 'seat',
  NAMED: 'named',
} as const;
export type RegionKind = (typeof REGION_KIND)[keyof typeof REGION_KIND];

let loading = false;

/** Loading a question replaces every slot at once, which is the one legitimate reshape. */
export function whileLoadingScaffold(work: () => void): void {
  loading = true;
  try {
    work();
  } finally {
    loading = false;
  }
}

/** An attribute is a string or it is nothing; anything else would render as "[object Object]". */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const shapeOf = (doc: ProseNode): string => {
  const keys: string[] = [];
  doc.forEach((node) => keys.push(text(node.attrs.key)));
  return keys.join(' ');
};

function figuresIn(slot: ProseNode): number {
  let count = 0;
  slot.descendants((node) => {
    if (node.type.name === FIGURE_NODE) count += 1;
  });
  return count;
}

/** The label of a slot that holds a value and was just handed a figure, which only a slot of prose takes. */
function valueGivenFigure(before: ProseNode, after: ProseNode): string | null {
  for (let index = 0; index < after.childCount; index += 1) {
    const slot = after.child(index);
    if (slot.attrs.roman === 'true' && figuresIn(slot) > figuresIn(before.child(index))) {
      return text(slot.attrs.label);
    }
  }
  return null;
}

/** The content is the typist's, the shape is not: no key of theirs takes a slot away, and a value takes no figure. */
function keepsScaffold(tr: Transaction, state: EditorState): boolean {
  if (loading || !tr.docChanged) return true;
  if (shapeOf(tr.doc) !== shapeOf(state.doc)) return false;

  const refused = valueGivenFigure(state.doc, tr.doc);
  if (refused === null) return true;
  toast.error(`${refused} takes text only. That image was not added.`);
  return false;
}

/** A slot ends on a line of text, or a figure or a table at its end leaves nowhere beneath it to type. */
function seated(state: EditorState): Transaction | null {
  const line = state.schema.nodes.paragraph;
  if (!line) return null;
  const { tr } = state;

  state.doc.forEach((region, offset) => {
    if (region.lastChild?.type === line) return;
    tr.insert(tr.mapping.map(offset + region.nodeSize - 1), line.create());
  });

  return tr.docChanged ? tr : null;
}

/** Tiptap's and ProseMirror's own meta keys, named because a typo in either fails without a word. */
export const TRANSACTION_META = {
  PREVENT_UPDATE: 'preventUpdate',
  ADD_TO_HISTORY: 'addToHistory',
} as const;

/** The first document arrives with no transaction behind it, so this one seats it: unreported, and nothing to undo. */
export function seatLoadedScaffold(view: EditorView): void {
  const { PREVENT_UPDATE, ADD_TO_HISTORY } = TRANSACTION_META;
  view.dispatch(view.state.tr.setMeta(PREVENT_UPDATE, true).setMeta(ADD_TO_HISTORY, false));
}

/** What the typist wrote in a slot: the empty line it ends on is the caret's seat, not content. */
export function writtenIn(region: ProseNode): Fragment {
  const last = region.lastChild;
  if (!last || last.type !== region.type.schema.nodes.paragraph || last.content.size > 0) {
    return region.content;
  }
  return region.content.cut(0, region.content.size - last.nodeSize);
}

/** The top node accepts nothing but slots, so a paste can never land text beside the scaffold. */
export const ScaffoldDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `${REGION_NODE}+`,
});

/** One attribute, written and read back through the same `data-` name and nothing else. */
const attribute = (name: string, dataAttr: string) => {
  const dataset = dataAttr.slice('data-'.length);
  return {
    default: '',
    parseHTML: (element: HTMLElement) => element.dataset[dataset] ?? '',
    renderHTML: (attrs: Record<string, unknown>) => ({ [dataAttr]: text(attrs[name]) }),
  };
};

export const ScaffoldRegionNode = Node.create({
  name: REGION_NODE,
  group: 'block',
  content: 'block+',
  isolating: true,
  defining: true,
  selectable: false,

  addAttributes() {
    return {
      key: attribute('key', 'data-region'),
      label: attribute('label', 'data-label'),
      kind: { ...attribute('kind', 'data-kind'), default: REGION_KIND.PLAIN },
      hint: attribute('hint', 'data-hint'),
      roman: attribute('roman', 'data-roman'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-region]', contentElement: '.scaffold-body' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'scaffold-region' }),
      ['span', { class: 'scaffold-label', contenteditable: 'false' }, text(node.attrs.label)],
      ['div', { class: 'scaffold-body' }, 0],
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: keepsScaffold,
        appendTransaction: (_transactions, _before, state) => seated(state),
        props: { decorations: hints },
      }),
    ];
  },
});
