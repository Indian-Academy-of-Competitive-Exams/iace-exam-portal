/**
 * One labelled slot. The label is the node's own chrome, rendered OUTSIDE the content hole,
 * so it is not in the document at all and cannot be typed over, split, selected or deleted.
 * `isolating` stops a join or a backspace merging two slots, which is what would let the
 * shape drift.
 */
import { Node, mergeAttributes } from '@tiptap/core';
export const REGION_NODE = 'scaffoldRegion';

/** The top node accepts nothing but slots, so a paste can never land text beside the scaffold. */
export const ScaffoldDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `${REGION_NODE}+`,
});

export const ScaffoldRegionNode = Node.create({
  name: REGION_NODE,
  group: 'block',
  content: 'block+',
  isolating: true,
  defining: true,
  selectable: false,

  addAttributes() {
    return {
      key: { default: '', parseHTML: (element) => element.dataset.region ?? '' },
      label: { default: '', parseHTML: (element) => element.dataset.label ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-region]', contentElement: '.scaffold-body' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = String(node.attrs.label ?? '');
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-region': String(node.attrs.key ?? ''),
        'data-label': label,
        class: 'scaffold-region',
      }),
      ['span', { class: 'scaffold-label', contenteditable: 'false' }, label],
      ['div', { class: 'scaffold-body' }, 0],
    ];
  },
});
