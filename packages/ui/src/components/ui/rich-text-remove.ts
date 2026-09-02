/**
 * The control that takes a block back out. A figure and a table are the two things in the box
 * a caret cannot sit beside and read, so each carries its own way out rather than hiding one
 * in a menu the typist has to know is there.
 */
import { type EditorView } from '@tiptap/pm/view';

export const REMOVE_LABELS = {
  image: 'Remove image',
  table: 'Remove table',
} as const;

/** A round × that deletes the node at `at`. Styled by `.rich-remove` in components.css. */
export function removeControl(
  label: string,
  view: () => EditorView | null,
  at: () => number | undefined,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rich-remove';
  button.setAttribute('aria-label', label);
  button.textContent = '×';

  // mousedown, not click: ProseMirror would otherwise move the selection out from under it.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const editorView = view();
    const pos = at();
    if (!editorView || pos === undefined) return;

    const node = editorView.state.doc.nodeAt(pos);
    if (!node) return;
    editorView.dispatch(editorView.state.tr.delete(pos, pos + node.nodeSize));
    editorView.focus();
  });

  return button;
}
