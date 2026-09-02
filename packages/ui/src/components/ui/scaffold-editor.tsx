import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { TableKit } from '@tiptap/extension-table';
import { DOMSerializer, type Node as ProseNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';
import { cn } from '../../lib/utils';
import { RichTextToolbar, type MathDraft } from './rich-text-toolbar';
import {
  QuestionImage,
  imageFilesIn,
  insertUploaded,
  type ImageLimits,
  type UploadImage,
} from './rich-text-image';
import {
  REGION_KIND,
  REGION_NODE,
  SCAFFOLD_SHAPE,
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
}

/** A run of slots the keyboard grows and shrinks; the caller names them, so this file holds none. */
export interface ScaffoldRepeat {
  /** A slot belongs to the run when its key starts with this. */
  prefix: string;
  keyOf: (index: number) => string;
  labelAt: (index: number) => string;
  min: number;
  max: number;
}

export interface ScaffoldEditorProps {
  regions: readonly ScaffoldRegion[];
  /** Changing it reloads the box from `regions` — a different question, or the same one in another language. */
  docKey: string;
  onChange: (regions: ScaffoldRegion[]) => void;
  repeat?: ScaffoldRepeat;
  /** Ctrl+Enter. */
  onSave?: () => void;
  /** The one action that is not Up, Down or Enter, because a language is a mode over the whole box. */
  onCycleLanguage?: () => void;
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
  view: unknown,
  data: DataTransfer | null,
  upload: UploadImage | undefined,
  limits: ImageLimits | undefined,
): boolean {
  if (!upload) return false;
  const files = imageFilesIn(data);
  if (files.length === 0) return false;

  const editor = (view as unknown as { editor: Parameters<typeof insertUploaded>[0] }).editor;
  for (const file of files) insertUploaded(editor, file, upload, limits);
  return true;
}

const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ESCAPED[char]!);

/** Html in, and `regionsOf` gives html back: one shape, however a slot was built. */
function docFrom(regions: readonly ScaffoldRegion[]): string {
  return regions
    .map(
      (region) =>
        `<div data-region="${escape(region.key)}" data-label="${escape(region.label)}"` +
        ` data-kind="${escape(region.kind ?? REGION_KIND.PLAIN)}">` +
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
  repeat,
  onSave,
  onCycleLanguage,
  onUploadImage,
  imageLimits,
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
  const run = React.useRef<KeyContext>({ repeat, onSave, onCycleLanguage });
  React.useEffect(() => {
    emit.current = onChange;
    run.current = { repeat, onSave, onCycleLanguage };
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
      ...(onUploadImage ? [QuestionImage] : []),
      Mathematics.configure({
        // A half-typed formula shows in red rather than taking the editor down with it.
        katexOptions: { throwOnError: false },
        inlineOptions: {
          onClick: (node, pos) => setMath({ latex: String(node.attrs.latex ?? ''), pos }),
        },
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
  repeat?: ScaffoldRepeat;
  onSave?: () => void;
  onCycleLanguage?: () => void;
}

/** Enter never splits a slot — the key that would break the shape moves the caret instead. */
function handleKey(view: EditorView, event: KeyboardEvent, context: KeyContext): boolean {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    context.onSave?.();
    return true;
  }
  if (event.key.toLowerCase() === 'l' && event.altKey) {
    context.onCycleLanguage?.();
    return true;
  }

  const index = regionIndexAt(view);

  if (event.key === 'Enter' && !event.shiftKey) return onEnter(view, index, context.repeat);

  if (event.key === 'ArrowDown' && atEdge(view, 'end')) {
    return moveToRegion(view, index + 1, false);
  }
  if (event.key === 'ArrowUp' && atEdge(view, 'start')) {
    return moveToRegion(view, index - 1, true);
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    return onDelete(view, index, event.key, context.repeat);
  }

  return false;
}

/** Deleting clears what a selection covers, or drops the empty slot the caret sits at the top of. */
function onDelete(
  view: EditorView,
  index: number,
  key: string,
  repeat: ScaffoldRepeat | undefined,
): boolean {
  if (clearAcrossSlots(view)) return true;
  if (key !== 'Backspace' || !repeat || !atEdge(view, 'start')) return false;
  return removeEmpty(view, index, repeat);
}

/** A selection past one slot empties what it covers; deleting it would take the scaffold. */
function clearAcrossSlots(view: EditorView): boolean {
  const { selection, doc, schema, tr } = view.state;
  if (selection.empty) return false;

  const first = doc.resolve(selection.from).index(0);
  const last = doc.resolve(Math.min(selection.to, doc.content.size - 1)).index(0);
  if (first >= last) return false;

  // Backwards, so each replacement leaves the positions of the ones before it alone.
  for (let index = last; index >= first; index -= 1) {
    const start = startOf(doc, index);
    tr.replaceWith(
      start + 1,
      start + doc.child(index).nodeSize - 1,
      schema.nodes.paragraph!.create(),
    );
  }

  view.dispatch(tr);
  return moveToRegion(view, first, false);
}

/** Enter grows the run, leaves the empty slot it just made, or simply moves on. */
function onEnter(view: EditorView, index: number, repeat: ScaffoldRepeat | undefined): boolean {
  if (!repeat || !isLastOfRun(view, index, repeat)) return moveToRegion(view, index + 1, false);
  if (isEmpty(view, index)) return leaveRun(view, index, repeat);
  return addAfter(view, index, repeat) || moveToRegion(view, index + 1, false);
}

function atEdge(view: EditorView, edge: 'start' | 'end'): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty) return false;
  const region = $from.node(1);
  if (!region) return false;
  const start = $from.start(1);
  return edge === 'start' ? $from.pos === start + 1 : $from.pos === start + region.content.size - 1;
}

function runIndexes(view: EditorView, repeat: ScaffoldRepeat): number[] {
  const found: number[] = [];
  view.state.doc.forEach((node, _pos, index) => {
    if (String(node.attrs.key ?? '').startsWith(repeat.prefix)) found.push(index);
  });
  return found;
}

function isLastOfRun(view: EditorView, index: number, repeat: ScaffoldRepeat): boolean {
  const inRun = runIndexes(view, repeat);
  return inRun.length > 0 && inRun.at(-1) === index;
}

function isEmpty(view: EditorView, index: number): boolean {
  const node = view.state.doc.child(index);
  if (node.textContent.trim() !== '') return false;

  // A figure or an equation says something without saying any text.
  let carries = false;
  node.descendants((child) => {
    if (child.isLeaf && !child.isText) carries = true;
  });
  return !carries;
}

/** Out of the run and on to what follows it, taking the empty slot that was left behind. */
function leaveRun(view: EditorView, index: number, repeat: ScaffoldRepeat): boolean {
  if (runIndexes(view, repeat).length <= repeat.min) return moveToRegion(view, index + 1, false);

  const doc = view.state.doc;
  const start = startOf(doc, index);
  view.dispatch(
    view.state.tr.delete(start, start + doc.child(index).nodeSize).setMeta(SCAFFOLD_SHAPE, true),
  );
  relabelRun(view, repeat);
  return moveToRegion(view, index, false);
}

/** Enter on the last one adds the next, exactly like adding a list item. */
function addAfter(view: EditorView, index: number, repeat: ScaffoldRepeat): boolean {
  const inRun = runIndexes(view, repeat);
  if (inRun.length >= repeat.max) return false;

  const { schema, doc, tr } = view.state;
  const end = startOf(doc, index) + doc.child(index).nodeSize;

  const added = schema.nodes[REGION_NODE]!.create(
    {
      key: repeat.keyOf(inRun.length),
      label: repeat.labelAt(inRun.length),
      kind: REGION_KIND.SEAT,
    },
    schema.nodes.paragraph!.create(),
  );

  view.dispatch(tr.insert(end, added).setMeta(SCAFFOLD_SHAPE, true));
  return moveToRegion(view, index + 1, false);
}

/** Backspace on an empty one takes it and its label away, never leaving a gap in the letters. */
function removeEmpty(view: EditorView, index: number, repeat: ScaffoldRepeat): boolean {
  const inRun = runIndexes(view, repeat);
  if (!inRun.includes(index) || inRun.length <= repeat.min) return false;

  if (!isEmpty(view, index)) return false;

  const doc = view.state.doc;
  const start = startOf(doc, index);
  view.dispatch(
    view.state.tr.delete(start, start + doc.child(index).nodeSize).setMeta(SCAFFOLD_SHAPE, true),
  );
  relabelRun(view, repeat);
  return moveToRegion(view, index - 1, true);
}

/** The letters are positions, not names: dropping (B) makes the old (C) the new (B). */
function relabelRun(view: EditorView, repeat: ScaffoldRepeat): void {
  const transaction = view.state.tr;
  let seat = 0;

  view.state.doc.forEach((node, pos) => {
    if (!String(node.attrs.key ?? '').startsWith(repeat.prefix)) return;
    transaction.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      key: repeat.keyOf(seat),
      label: repeat.labelAt(seat),
    });
    seat += 1;
  });

  if (transaction.docChanged) view.dispatch(transaction.setMeta(SCAFFOLD_SHAPE, true));
}

/** Where the nth slot begins in the document. */
function startOf(doc: ProseNode, index: number): number {
  let start = 0;
  for (let i = 0; i < index; i += 1) start += doc.child(i).nodeSize;
  return start;
}
