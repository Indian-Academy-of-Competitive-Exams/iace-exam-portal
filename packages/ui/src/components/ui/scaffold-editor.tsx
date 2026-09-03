import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { TableKit } from '@tiptap/extension-table';
import { DOMSerializer, type Node as ProseNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';
import { cn } from '../../lib/utils';
import { TableTools } from './rich-text-table';
import { Transliterate, writeIn, type IndicScript } from './rich-text-transliterate';
import { BlockMathAtDollars, InlineMathAtDollar } from './rich-text-math';
import { RichTextToolbar, type MathDraft } from './rich-text-toolbar';
import {
  QuestionImage,
  imageFilesIn,
  insertUploadedInto,
  type ImageLimits,
  type UploadImage,
} from './rich-text-image';
import {
  REGION_KIND,
  REGION_NODE,
  ScaffoldDocument,
  ScaffoldRegionNode,
  whileLoadingScaffold,
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
  disabled?: boolean;
  lang?: string;
  'aria-label': string;
  className?: string;
}

const SHELL = [
  'flex flex-col rounded-md border border-input bg-surface text-sm text-foreground shadow-sm',
  'transition-[box-shadow,border-color] focus-within:border-ring focus-within:shadow-focus',
].join(' ');

const CONTENT =
  'scaffold-content rich-content outline-none [&_.ProseMirror]:outline-none [&_p]:m-0';

/** True when it swallowed the event, which is what stops ProseMirror inlining the bytes itself. */
function takeImages(
  view: EditorView,
  data: DataTransfer | null,
  upload: UploadImage | undefined,
  limits: ImageLimits | undefined,
): boolean {
  if (!upload) return false;
  const files = imageFilesIn(data);
  if (files.length === 0) return false;

  for (const file of files) insertUploadedInto(view, file, upload, limits);
  return true;
}

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
        ` data-hint="${escape(region.hint ?? '')}">` +
        `<div class="scaffold-body">${region.html || '<p></p>'}</div></div>`,
    )
    .join('');
}

/** Every slot, in document order, with its body serialised back to html. */
export function regionsOf(editor: Editor): ScaffoldRegion[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const out: ScaffoldRegion[] = [];

  editor.state.doc.forEach((node: ProseNode) => {
    if (node.type.name !== REGION_NODE) return;
    const holder = document.createElement('div');
    holder.append(serializer.serializeFragment(node.content));
    out.push({
      key: String(node.attrs.key ?? ''),
      label: String(node.attrs.label ?? ''),
      kind: String(node.attrs.kind ?? REGION_KIND.PLAIN) as RegionKind,
      html: holder.innerHTML === '<p></p>' ? '' : holder.innerHTML,
    });
  });

  return out;
}

/** The slot the caret is in, as an index into the document's top-level children. */
function regionIndexAt(view: EditorView): number {
  return view.state.doc.resolve(view.state.selection.from).index(0);
}

/** The document position just inside the nth slot's first (or last) paragraph. */
function insideRegion(view: EditorView, index: number, atEnd: boolean): number | null {
  const doc = view.state.doc;
  if (index < 0 || index >= doc.childCount) return null;

  const start = startOf(doc, index);
  const node = doc.child(index);
  return atEnd ? start + node.nodeSize - 2 : start + 2;
}

function moveToRegion(view: EditorView, index: number, atEnd: boolean): boolean {
  const inside = insideRegion(view, index, atEnd);
  if (inside === null) return false;

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
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
  script = null,
  disabled = false,
  lang,
  'aria-label': label,
  className,
}: Readonly<ScaffoldEditorProps>) {
  const [math, setMath] = React.useState<MathDraft | null>(null);
  // The editor emits an update for its INITIAL content, which is a load and not a keystroke.
  const settled = React.useRef(false);
  // Created once, so its handlers read these rather than closing over the first render's props.
  const emit = React.useRef(onChange);
  const run = React.useRef<KeyContext>({ onSave, onCycleLanguage });
  React.useEffect(() => {
    emit.current = onChange;
    run.current = { onSave, onCycleLanguage };
  });

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({ document: false, heading: false, horizontalRule: false }),
      ScaffoldDocument,
      ScaffoldRegionNode,
      Superscript,
      Subscript,
      TableKit.configure({ table: { resizable: true } }),
      TableTools,
      Transliterate,
      ...(onUploadImage ? [QuestionImage] : []),
      // A half-typed formula shows in red rather than taking the editor down with it.
      BlockMathAtDollars.configure({ katexOptions: { throwOnError: false } }),
      InlineMathAtDollar.configure({
        katexOptions: { throwOnError: false },
        onClick: (node, pos) => setMath({ latex: String(node.attrs.latex ?? ''), pos }),
      }),
    ],
    content: docFrom(regions),
    onUpdate: ({ editor: current }: { editor: Editor }) => {
      if (!settled.current) return;
      emit.current(regionsOf(current));
    },
    editorProps: {
      handleKeyDown: (view, event) => handleKey(view, event, run.current),
      // Without these a pasted image becomes a base64 `data:` uri inside the question row.
      handlePaste: (view, event) =>
        takeImages(view, event.clipboardData, onUploadImage, imageLimits),
      handleDrop: (view, event) =>
        takeImages(view, (event as DragEvent).dataTransfer, onUploadImage, imageLimits),
      attributes: {
        class: CONTENT,
        role: 'textbox',
        'aria-label': label,
        ...(lang ? { lang } : {}),
      },
    },
  });

  // After the editor exists, so its creation update has already been and gone.
  React.useEffect(() => {
    if (editor) settled.current = true;
  }, [editor]);

  React.useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  // A transaction, not a ref: the plugin carries the script and the editor is built once.
  React.useEffect(() => {
    if (editor) writeIn(editor.view, script);
  }, [editor, script]);

  // Keyed, not compared: only another question or another language may discard what is typed.
  const loaded = React.useRef(docKey);
  React.useEffect(() => {
    if (!editor || loaded.current === docKey) return;
    loaded.current = docKey;
    whileLoadingScaffold(() => editor.commands.setContent(docFrom(regions), { emitUpdate: false }));
    // Back at the first slot, which after a save is the stem of the next question.
    editor.commands.focus('start');
  }, [editor, docKey, regions]);

  return (
    <div className={cn(SHELL, disabled && 'bg-disabled', className)} data-focus-ring="wrapper">
      {editor && !disabled ? (
        <RichTextToolbar
          // Pinned: the box runs the height of the column, and the tools have to stay reachable.
          className="sticky top-0 z-[--z-sticky] px-3"
          editor={editor}
          math={math}
          onMathChange={setMath}
          onUploadImage={onUploadImage}
          imageLimits={imageLimits}
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

  if (event.key === 'Enter' && !event.shiftKey) return moveToRegion(view, index + 1, false);

  if (event.key === 'ArrowDown' && atEdge(view, 'end')) {
    return moveToRegion(view, index + 1, false);
  }
  if (event.key === 'ArrowUp' && atEdge(view, 'start')) {
    return moveToRegion(view, index - 1, true);
  }
  if (event.key === 'Backspace' || event.key === 'Delete') return clearAcrossSlots(view);

  return false;
}

/** A selection past one slot empties what it covers; deleting it would take the scaffold. */
function clearAcrossSlots(view: EditorView): boolean {
  const { selection, doc, schema, tr } = view.state;
  if (selection.empty) return false;

  const first = doc.resolve(selection.from).index(0);
  const last = doc.resolve(Math.min(selection.to, doc.content.size - 1)).index(0);
  if (first >= last) return false;

  // The schema this editor is built on always defines a paragraph; without one there is no doc.
  const paragraph = schema.nodes.paragraph;
  if (paragraph === undefined) return false;

  // Backwards, so each replacement leaves the positions of the ones before it alone.
  for (let index = last; index >= first; index -= 1) {
    const start = startOf(doc, index);
    tr.replaceWith(start + 1, start + doc.child(index).nodeSize - 1, paragraph.create());
  }

  view.dispatch(tr);
  return moveToRegion(view, first, false);
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
