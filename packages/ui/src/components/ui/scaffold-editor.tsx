import * as React from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { DOMSerializer, type Node as ProseNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';
import { cn } from '../../lib/utils';
import { TableTools } from './rich-text-table';
import { Transliterate, writeIn, type IndicScript } from './rich-text-transliterate';
import { RichTextToolbar } from './rich-text-toolbar';
import type { ImageLimits, UploadImage } from './rich-text-image';
import { NOT_STORED, useQuestionEditor } from './rich-text';
import {
  REGION_KIND,
  REGION_NODE,
  ScaffoldDocument,
  ScaffoldRegionNode,
  TRANSACTION_META,
  seatLoadedScaffold,
  whileLoadingScaffold,
  writtenIn,
  type RegionKind,
} from './scaffold-region';

/** One slot: what it is called, and what is in it. `label` is chrome the caret never enters. */
export interface ScaffoldRegion {
  key: string;
  label: string;
  html: string;
  kind?: RegionKind;
  /** What goes here, said in the slot while it is empty. A rule or a format, never a description. */
  hint?: string;
  /** Holds a value rather than prose, so it stays in Roman letters whatever script is chosen. */
  roman?: boolean;
}

export interface ScaffoldEditorProps {
  regions: readonly ScaffoldRegion[];
  /** Changing it reloads the box from `regions` — a different question, or the same one in another language. */
  docKey: string;
  onChange: (regions: ScaffoldRegion[]) => void;
  /** Ctrl+Enter. */
  onSave?: () => void;
  /** The one action that is not Up, Down or Enter, because a language is a mode over the whole box. */
  onCycleLanguage?: () => void;
  /** Turns Roman letters into this script as they are typed. Null types them through. */
  script?: IndicScript | null;
  onUploadImage?: UploadImage;
  imageLimits?: ImageLimits;
  /** At the toolbar's right end, for a control over the whole box. */
  toolbarEnd?: React.ReactNode;
  /** Shown and not typed into: the grey a disabled field wears, and no toolbar. */
  disabled?: boolean;
  lang?: string;
  'aria-label': string;
  className?: string;
}

const SHELL = [
  'flex flex-col rounded-md border border-input bg-surface text-sm text-foreground shadow-sm',
  'transition-[box-shadow,border-color] focus-within:border-ring focus-within:shadow-focus',
].join(' ');

/** The same grey a disabled `RichText` wears, so one question reads as off the same way everywhere. */
const OFF = 'cursor-not-allowed border-disabled-border bg-disabled text-disabled-foreground';

const CONTENT =
  'scaffold-content rich-content outline-none [&_.ProseMirror]:outline-none [&_p]:m-0';

/** Built once: a fresh array of configured extensions fails `useEditor`'s compare, and every render then rebuilds the view's props. */
const EXTENSIONS = [
  StarterKit.configure({ ...NOT_STORED, document: false }),
  ScaffoldDocument,
  ScaffoldRegionNode,
  TableKit.configure({ table: { resizable: true } }),
  TableTools,
  Transliterate,
];

const ESCAPED: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ESCAPED[char] ?? char);

/** Html in, and `regionsOf` gives html back: one shape, however a slot was built. */
function docFrom(regions: readonly ScaffoldRegion[]): string {
  return regions
    .map(
      (region) =>
        `<div data-region="${escape(region.key)}" data-label="${escape(region.label)}"` +
        ` data-kind="${escape(region.kind ?? REGION_KIND.PLAIN)}"` +
        ` data-hint="${escape(region.hint ?? '')}"` +
        ` data-roman="${region.roman ? 'true' : ''}">` +
        `<div class="scaffold-body">${region.html || '<p></p>'}</div></div>`,
    )
    .join('');
}

/** Every slot, in document order, with its body serialised back to html. */
function regionsOf(editor: Editor): ScaffoldRegion[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const out: ScaffoldRegion[] = [];

  editor.state.doc.forEach((node: ProseNode) => {
    if (node.type.name !== REGION_NODE) return;
    const holder = document.createElement('div');
    holder.append(serializer.serializeFragment(writtenIn(node)));
    out.push({
      key: String(node.attrs.key ?? ''),
      label: String(node.attrs.label ?? ''),
      kind: String(node.attrs.kind ?? REGION_KIND.PLAIN) as RegionKind,
      roman: node.attrs.roman === 'true',
      html: holder.innerHTML,
    });
  });

  return out;
}

/** The slot the caret is in, as an index into the document's top-level children. */
function regionIndexAt(view: EditorView): number {
  return view.state.doc.resolve(view.state.selection.from).index(0);
}

/** The first (or last) place in the nth slot that takes text, which a figure or a table at its edge is not. */
function textIn(view: EditorView, index: number, atEnd: boolean): Selection | null {
  const doc = view.state.doc;
  if (index < 0 || index >= doc.childCount) return null;

  const start = startOf(doc, index);
  const edge = atEnd ? start + doc.child(index).nodeSize - 1 : start + 1;
  return Selection.findFrom(doc.resolve(edge), atEnd ? -1 : 1, true);
}

function moveToRegion(view: EditorView, index: number, atEnd: boolean): boolean {
  const caret = textIn(view, index, atEnd);
  if (caret === null) return false;

  view.dispatch(view.state.tr.setSelection(caret));
  view.focus();
  return true;
}

export function ScaffoldEditor({
  regions,
  docKey,
  onChange,
  onSave,
  onCycleLanguage,
  onUploadImage,
  imageLimits,
  toolbarEnd,
  disabled = false,
  script = null,
  lang,
  'aria-label': label,
  className,
}: Readonly<ScaffoldEditorProps>) {
  // Created once, so its handlers read these rather than closing over the first render's props.
  const emit = React.useRef(onChange);
  const run = React.useRef<KeyContext>({ onSave, onCycleLanguage });
  React.useEffect(() => {
    emit.current = onChange;
    run.current = { onSave, onCycleLanguage };
  });

  const editorProps = React.useMemo(
    () => ({
      handleKeyDown: (view: EditorView, event: KeyboardEvent) =>
        handleKey(view, event, run.current),
      handleDOMEvents: { cut: cutAcrossSlots },
      attributes: {
        class: CONTENT,
        role: 'textbox',
        'aria-label': label,
        ...(lang ? { lang } : {}),
      },
    }),
    [label, lang],
  );

  const { editor, math, setMath } = useQuestionEditor({
    editable: !disabled,
    extensions: EXTENSIONS,
    content: docFrom(regions),
    onUpdate: (current) => emit.current(regionsOf(current)),
    onUploadImage,
    imageLimits,
    editorProps,
  });

  // Before any other transaction, or the first one would report the seats as the typist's edit.
  React.useEffect(() => {
    if (editor) seatLoadedScaffold(editor.view);
  }, [editor]);

  // A transaction, not a ref: the plugin carries the script and the editor is built once.
  React.useEffect(() => {
    if (editor) writeIn(editor.view, script);
  }, [editor, script]);

  // Keyed, not compared: only another question or another language may discard what is typed.
  const loaded = React.useRef(docKey);
  React.useEffect(() => {
    if (!editor || loaded.current === docKey) return;
    loaded.current = docKey;
    // Out of the history, or Undo would bring the last question or language back into this one.
    whileLoadingScaffold(() =>
      editor
        .chain()
        .setMeta(TRANSACTION_META.ADD_TO_HISTORY, false)
        .setContent(docFrom(regions), { emitUpdate: false })
        .run(),
    );
    // Back at the first slot, which after a save is the stem of the next question.
    if (!disabled) editor.commands.focus('start');
  }, [editor, docKey, regions, disabled]);

  return (
    <div
      className={cn(SHELL, disabled && OFF, className)}
      aria-disabled={disabled || undefined}
      data-focus-ring="wrapper"
    >
      {/* No toolbar when it is off: a row of dead buttons says nothing the grey does not. */}
      {editor && !disabled ? (
        <RichTextToolbar
          // Pinned: the box runs the height of the column, and the tools have to stay reachable.
          className="sticky top-0 z-[--z-sticky] px-3"
          editor={editor}
          math={math}
          onMathChange={setMath}
          onUploadImage={onUploadImage}
          imageLimits={imageLimits}
          end={toolbarEnd}
        />
      ) : null}
      {/* No scroller of its own: the panel scrolls, so a long question never strands the box. */}
      <EditorContent editor={editor} className="min-h-64 flex-1 p-3 [&>.ProseMirror]:min-h-full" />
    </div>
  );
}

interface KeyContext {
  onSave?: () => void;
  onCycleLanguage?: () => void;
}

/** Enter never splits a slot — the key that would break the shape moves the caret instead. */
function handleKey(view: EditorView, event: KeyboardEvent, context: KeyContext): boolean {
  // An input method owns these first: Enter commits its candidate and the arrows pick one.
  if (view.composing || event.isComposing) return false;

  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    context.onSave?.();
    return true;
  }
  // `code`, not `key`: Option+L on a Mac arrives as "¬", and the shortcut never fired.
  if (event.code === 'KeyL' && event.altKey) {
    context.onCycleLanguage?.();
    return true;
  }

  const index = regionIndexAt(view);

  if (event.key === 'Enter' && !event.shiftKey) {
    return !ownsEnter(view) && moveToRegion(view, index + 1, false);
  }

  if (event.key === 'ArrowDown' && atEdge(view, 'end')) {
    return moveToRegion(view, index + 1, false);
  }
  if (event.key === 'ArrowUp' && atEdge(view, 'start')) {
    return moveToRegion(view, index - 1, true);
  }
  if (event.key === 'Backspace' || event.key === 'Delete') return clearAcrossSlots(view);

  return false;
}

/** A slot is depth 1 and a line in it 2, so a caret any deeper is in a list item or a table cell, whose Enter is its own. */
function ownsEnter(view: EditorView): boolean {
  return view.state.selection.$from.depth > 2;
}

/** A selection past one slot loses what it covers in each, slot by slot; deleting it whole would join the slots. */
function clearAcrossSlots(view: EditorView): boolean {
  const { selection, doc, tr } = view.state;
  if (selection.empty) return false;

  const first = doc.resolve(selection.from).index(0);
  const last = doc.resolve(Math.min(selection.to, doc.content.size - 1)).index(0);
  if (first >= last) return false;

  let from = selection.from;
  // Backwards, so each deletion leaves the positions of the ones before it alone.
  for (let index = last; index >= first; index -= 1) {
    const start = startOf(doc, index) + 1;
    from = Math.max(start, selection.from);
    const to = Math.min(start + doc.child(index).content.size, selection.to);
    if (from < to) tr.delete(from, to);
  }

  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(from))));
  view.focus();
  return true;
}

/** ProseMirror's own cut deletes across the slots, which the scaffold refuses, leaving a cut that only copied. */
function cutAcrossSlots(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  const cut = view.state.selection.content();
  // A box that is switched off still hears the event, and has nothing to give up.
  if (!data || !view.editable || !clearAcrossSlots(view)) return false;

  const { dom, text } = view.serializeForClipboard(cut);
  event.preventDefault();
  data.clearData();
  data.setData('text/html', dom.innerHTML);
  data.setData('text/plain', text);
  return true;
}

function atEdge(view: EditorView, edge: 'start' | 'end'): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty) return false;
  const region = $from.node(1);
  if (!region) return false;
  const start = $from.start(1);
  return edge === 'start' ? $from.pos === start + 1 : $from.pos === start + region.content.size - 1;
}

/** Where the nth slot begins in the document. */
function startOf(doc: ProseNode, index: number): number {
  let start = 0;
  for (let i = 0; i < index; i += 1) start += doc.child(i).nodeSize;
  return start;
}
