/**
 * One labelled slot. The label is the node's own chrome, rendered OUTSIDE the content hole,
 * so it is not in the document at all and cannot be typed over, split, selected or deleted.
 * `isolating` stops a join or a backspace merging two slots; the plugin below stops anything
 * else — a select-all and a delete included — from changing which slots there are.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { type Node as ProseNode } from '@tiptap/pm/model';

export const REGION_NODE = 'scaffoldRegion';

/** Marks the transactions allowed to change the shape: the ones the editor's own commands make. */
export const SCAFFOLD_SHAPE = 'scaffoldShape';

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
        // The content is the typist's, the shape is not: no key of theirs takes a slot away.
        filterTransaction: (tr: Transaction, state) =>
          loading ||
          !tr.docChanged ||
          Boolean(tr.getMeta(SCAFFOLD_SHAPE)) ||
          shapeOf(tr.doc) === shapeOf(state.doc),
      }),
    ];
  },
});
