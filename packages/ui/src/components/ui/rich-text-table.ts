/**
 * Every table carries its own controls. They were in the toolbar, which meant one menu for
 * whichever table the caret happened to be in — and no way to add a second one while standing
 * in the first. A widget decoration and not a node view: TipTap's own table view drags columns.
 */
import { Extension } from '@tiptap/core';
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state';
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  isInTable,
  selectedRect,
} from '@tiptap/pm/tables';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { REMOVE_LABELS, removeControl } from './rich-text-remove';

const TABLE_NODE = 'table';

/** The row that names the columns. A table without it is a table nobody can read. */
const HEADER_ROW = 0;

type TableCommand = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

interface TableTool {
  label: string;
  glyph: string;
  run: TableCommand;
  /** Whether it means anything where the caret is now. */
  offered: (state: EditorState) => boolean;
}

/** Which row the caret stands in, or null when it is not in a table at all. */
function caretRow(state: EditorState): number | null {
  return isInTable(state) ? selectedRect(state).top : null;
}

const inSomeRow = (state: EditorState) => caretRow(state) !== null;

const TOOLS: readonly TableTool[] = [
  { label: 'Add a row below', glyph: '+ Row', run: addRowAfter, offered: inSomeRow },
  {
    label: 'Add a column to the right',
    glyph: '+ Column',
    run: addColumnAfter,
    offered: inSomeRow,
  },
  {
    label: 'Delete this row',
    glyph: '− Row',
    run: deleteRow,
    // The header never goes, so the control is not offered while the caret stands in it.
    offered: (state) => {
      const row = caretRow(state);
      return row !== null && row !== HEADER_ROW;
    },
  },
  { label: 'Delete this column', glyph: '− Column', run: deleteColumn, offered: inSomeRow },
];

/** Whether the caret stands in the table at `pos`. A control acts on its own table or on none. */
function caretIsIn(state: EditorState, pos: number): boolean {
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const from = state.selection.from;
  return from > pos && from < pos + node.nodeSize;
}

function toolButton(tool: TableTool, view: EditorView, live: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rich-table-tool';
  button.setAttribute('aria-label', tool.label);
  button.textContent = tool.glyph;
  button.disabled = !live;

  // mousedown, not click: ProseMirror would otherwise move the selection out from under it.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!live) return;
    tool.run(view.state, view.dispatch);
    view.focus();
  });

  return button;
}

function toolbarFor(view: EditorView, pos: number, state: EditorState): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'rich-table-tools';
  const mine = caretIsIn(state, pos);

  for (const tool of TOOLS) {
    bar.append(toolButton(tool, view, mine && tool.offered(state)));
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
              // Keyed on what the bar draws, so it is rebuilt only when that changes.
              const live = caretIsIn(state, pos)
                ? TOOLS.map((tool) => (tool.offered(state) ? '1' : '0')).join('')
                : 'none';
              widgets.push(
                Decoration.widget(pos, (at: EditorView) => toolbarFor(at, pos, state), {
                  key: `table:${pos}:${live}`,
                }),
              );
            });

            return DecorationSet.create(state.doc, widgets);
          },
        },
      }),
    ];
  },
});
