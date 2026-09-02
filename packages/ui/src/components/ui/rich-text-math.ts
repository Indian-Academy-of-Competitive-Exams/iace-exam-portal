import { InputRule } from '@tiptap/core';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { type Node as ProseNode } from '@tiptap/pm/model';

/** LaTeX as everyone types it — the extension ships one dollar more than that for each. */

/** The lookarounds are what keep `$$x$$` out of the inline rule while it is still being typed. */
const INLINE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/;
const BLOCK = /(?<!\$)\$\$([^$\n]+?)\$\$(?!\$)/;

const ruleFor = (find: RegExp) =>
  function addInputRules(this: { type: { create: (attrs: { latex: string }) => ProseNode } }) {
    return [
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return;
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  };

export const InlineMathAtDollar = InlineMath.extend({ addInputRules: ruleFor(INLINE) });
export const BlockMathAtDollars = BlockMath.extend({ addInputRules: ruleFor(BLOCK) });
