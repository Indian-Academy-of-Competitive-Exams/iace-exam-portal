/**
 * A step of emphasis, not a font size. The author picks smaller or larger and the PAPER decides
 * what that means, so a question cannot carry a px that fights the skin it will be printed in.
 */
import { Mark, mergeAttributes } from '@tiptap/core';

export const TEXT_SIZES = {
  SMALL: 'small',
  LARGE: 'large',
} as const;
export type TextSize = (typeof TEXT_SIZES)[keyof typeof TEXT_SIZES];

/** A data attribute, so it survives the sanitizer on the way in without widening the allow-list. */
export const SIZE_ATTR = 'data-size';

export const TEXT_SIZE_MARK = 'textSize';

export const TextSizeMark = Mark.create({
  name: TEXT_SIZE_MARK,

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(SIZE_ATTR),
        renderHTML: (attrs: Record<string, unknown>) =>
          typeof attrs.size === 'string' ? { [SIZE_ATTR]: attrs.size } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${SIZE_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
