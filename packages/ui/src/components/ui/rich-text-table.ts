/**
 * Every table carries its own controls. They were in the toolbar, which meant one menu for
 * whichever table the caret happened to be in — and no way to add a second one while standing
 * in the first. A widget decoration and not a node view: TipTap's own table view drags columns.
 */
import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow } from '@tiptap/pm/tables';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { REMOVE_LABELS, removeControl } from './rich-text-remove';

const TABLE_NODE = 'table';

type TableCommand = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView,
) => boolean;

/** What a typist does to a table, in the order they do it. */
const TOOLS: readonly { label: string; glyph: string; run: TableCommand }[] = [
  { label: 'Add a row below', glyph: '+ Row', run: addRowAfter },
  { label: 'Add a column to the right', glyph: '+ Column', run: addColumnAfter },
  { label: 'Delete this row', glyph: '− Row', run: deleteRow },
  { label: 'Delete this column', glyph: '− Column', run: deleteColumn },
];

/** Whether the caret already stands in the table at `pos`; if not, the controls put it there. */
function insideTable(state: EditorState, pos: number): boolean {
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const from = state.selection.from;
  return from > pos && from < pos + node.nodeSize;
}

/** A row is deleted where the caret is, so the caret goes into this table before anything runs. */
function runOnTable(view: EditorView, pos: number, command: TableCommand): void {
  if (!insideTable(view.state, pos)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))));
  }
  command(view.state, view.dispatch, view);
  view.focus();
}

function toolButton(label: string, glyph: string, onPress: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rich-table-tool';
  button.setAttribute('aria-label', label);
  button.textContent = glyph;
  // mousedown, not click: ProseMirror would otherwise move the selection out from under it.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onPress();
  });
  return button;
}

export const TableTools = Extension.create({
  name: 'tableTools',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const widgets: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== TABLE_NODE) return;
              widgets.push(Decoration.widget(pos, (view: EditorView) => toolbarFor(view, pos)));
            });

            return DecorationSet.create(state.doc, widgets);
          },
        },
      }),
    ];
  },
});

function toolbarFor(view: EditorView, pos: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'rich-table-tools';

  for (const tool of TOOLS) {
    bar.append(toolButton(tool.label, tool.glyph, () => runOnTable(view, pos, tool.run)));
  }

  bar.append(
    removeControl(
      REMOVE_LABELS.table,
      () => view,
      () => pos,
    ),
  );

  return bar;
}
