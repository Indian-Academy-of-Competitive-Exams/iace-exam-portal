import { ResizableNodeView } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { type Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, type Transaction } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';
import { REMOVE_LABELS, removeControl } from './rich-text-remove';
import { toast } from './toast';

/** What the app does with the bytes. `packages/ui` carries no api client, so this is passed in. */
export type UploadImage = (file: File) => Promise<{ key: string; url: string }>;

type Places = ReadonlyMap<symbol, number>;
type PlaceChange = { hold: symbol; at: number } | { release: symbol };

/** Where each picture still uploading will land: marked as it starts, and moved by every edit made while it does. */
const PLACES = new PluginKey<Places>('figurePlaces');

/** A step that swaps the document end to end is another question or language arriving, which no edit inside one is. */
function replacesDocument(tr: Transaction): boolean {
  return tr.steps.some((step, index) => {
    const size = tr.docs[index]?.content.size;
    let whole = false;
    step.getMap().forEach((from, to) => {
      if (from === 0 && to === size) whole = true;
    });
    return whole;
  });
}

const figurePlaces = new Plugin<Places>({
  key: PLACES,
  state: {
    init: () => new Map(),
    apply(tr, places) {
      const change = tr.getMeta(PLACES) as PlaceChange | undefined;
      if (!change && !tr.docChanged) return places;

      const next = new Map<symbol, number>();
      // Nothing bound for the document that left may land in the one that replaced it.
      if (!replacesDocument(tr)) {
        for (const [upload, pos] of places) next.set(upload, tr.mapping.map(pos));
      }
      if (change && 'hold' in change) next.set(change.hold, change.at);
      else if (change) next.delete(change.release);
      return next;
    },
  },
});

/** `data-key` is durable and `src` is per-session: the server strips src, so no image can rot. */
export const QuestionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-key': { default: null },
      width: { default: null },
    };
  },

  addProseMirrorPlugins() {
    return [figurePlaces];
  },

  /** A figure carries its own way out and its own corner to drag, the way a document does. */
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const image = document.createElement('img');
      for (const [name, value] of Object.entries(node.attrs)) {
        const text = asAttribute(value);
        if (text !== null) image.setAttribute(name, text);
      }

      const view = new ResizableNodeView({
        element: image,
        node,
        editor,
        getPos,
        options: {
          // The corner alone: a figure keeps its proportions, and a paper is read at one width.
          directions: ['bottom-right'],
          preserveAspectRatio: true,
          min: { width: IMAGE_MIN_PX, height: IMAGE_MIN_PX },
          className: {
            container: 'rich-figure',
            wrapper: 'rich-figure-frame',
            handle: 'rich-figure-handle',
            resizing: 'is-resizing',
          },
        },
        // Redraw the img from the node, so a width set anywhere reaches the element.
        onUpdate: (next) => {
          const width = asAttribute(next.attrs.width);
          if (width) image.setAttribute('width', width);
          image.removeAttribute('height');
          return true;
        },
        // Width alone: the height is the stylesheet's, which is what keeps the proportions.
        onCommit: (width) => {
          image.removeAttribute('height');
          image.style.removeProperty('height');
          editor.commands.updateAttributes(FIGURE_NODE, { width: Math.round(width) });
        },
      });

      view.wrapper.append(
        removeControl(
          REMOVE_LABELS.image,
          () => editor.view,
          () => getPos(),
        ),
      );

      return view;
    };
  },
});

export const FIGURE_NODE = 'image';

/** Below this a figure is a dot nobody can grab, let alone read. */
const IMAGE_MIN_PX = 40;

/** Only a primitive is an attribute value; anything else would render as "[object Object]". */
function asAttribute(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Only real image files; a dragged link or a copied cell is not one. */
export function imageFilesIn(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return [...data.items].flatMap((item) =>
    item.kind === 'file' && item.type.startsWith('image/') ? (item.getAsFile() ?? []) : [],
  );
}

/** What the field will take. Passed in, because a size limit is a product rule and not a design one. */
export interface ImageLimits {
  accept?: readonly string[];
  maxBytes?: number;
}

const megabytes = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/** Refused here so a file the server will reject is never uploaded at all. */
function refusalFor(file: File, limits: ImageLimits): string | null {
  const { accept, maxBytes } = limits;

  if (accept && !accept.includes(file.type)) {
    const readable = accept.map((type) => type.split('/')[1]?.toUpperCase()).join(', ');
    return `That file type is not accepted here. Upload one of: ${readable}.`;
  }

  if (maxBytes && file.size > maxBytes) {
    return `That image is larger than ${megabytes(maxBytes)}MB. Export it smaller, or save it as a PNG.`;
  }

  return null;
}

const NOT_ACCEPTED = 'That file type is not accepted here.';
const PLACE_GONE = 'That image was not added: the question changed while it was uploading';

/** Uploads first, then inserts where it was put, against the view: paste and drop hold only that, not the editor. */
export function insertUploaded(
  view: EditorView,
  file: File,
  upload: UploadImage,
  limits: ImageLimits = {},
  at?: number,
): void {
  const refusal = refusalFor(file, limits);
  if (refusal) {
    toast.error(refusal);
    return;
  }

  const place = Symbol(file.name);
  const mark = (change: PlaceChange) => view.dispatch(view.state.tr.setMeta(PLACES, change));
  mark({ hold: place, at: at ?? view.state.selection.from });
  const waiting = view.state.selection;

  // A rejection here was silently swallowed: the server refused the file and nothing said so.
  void upload(file)
    .then(({ key, url }) => {
      if (view.isDestroyed) return;
      const type = view.state.schema.nodes[FIGURE_NODE];
      if (!type) throw new Error('This field does not take images');
      const pos = PLACES.getState(view.state)?.get(place);
      if (pos === undefined) throw new Error(PLACE_GONE);
      // The caret follows only a typist who waited: one typing elsewhere keeps it.
      const follow = view.state.selection.eq(waiting);
      insertFigure(view, type.create({ src: url, 'data-key': key }), pos, follow);
    })
    .catch((error: unknown) =>
      toast.error((error instanceof Error && error.message) || 'That image could not be uploaded'),
    )
    .finally(() => {
      if (!view.isDestroyed) mark({ release: place });
    });
}

/** A figure is a block, so the caret goes to the line beneath it, and that line is made where there is none. */
function insertFigure(view: EditorView, figure: ProseNode, at: number, follow: boolean): void {
  const $at = view.state.doc.resolve(at);
  const blank = $at.parent.isTextblock && $at.parent.content.size === 0;
  const fits = blank && $at.node(-1).canReplaceWith($at.index(-1), $at.index(-1), figure.type);
  // Above a blank line rather than in place of it, so the line is still there for a second picture bound for it.
  const from = fits ? $at.before() : at;
  const tr = view.state.tr.replaceRangeWith(from, from, figure);
  // Where the insertion ended, read off its step the way ProseMirror places its own caret.
  let end = from;
  tr.mapping.maps.at(-1)?.forEach((_from, _to, _start, inserted) => {
    end = inserted;
  });

  const $end = tr.doc.resolve(end);
  if (!$end.parent.inlineContent && !$end.nodeAfter?.isTextblock) {
    const line = $end.parent.contentMatchAt($end.index()).defaultType?.createAndFill();
    if (line) tr.insert(end, line);
  }

  if (follow) {
    view.focus();
    tr.setSelection(Selection.near(tr.doc.resolve(end), 1)).scrollIntoView();
  }
  view.dispatch(tr);
}

/** True when it swallowed the event, which is what stops ProseMirror inlining the bytes itself. */
export function takeImages(
  view: EditorView,
  data: DataTransfer | null,
  upload: UploadImage | undefined,
  limits: ImageLimits | undefined,
  at?: number,
): boolean {
  if (!upload) return false;
  const files = imageFilesIn(data);
  if (files.length === 0) return false;

  for (const file of files) insertUploaded(view, file, upload, limits, at);
  return true;
}

/** A dropped file nobody took is refused out loud: left alone, the browser opens it in place of the page. */
export function refuseFiles(data: DataTransfer | null, limits: ImageLimits = {}): boolean {
  const dropped = [...(data?.items ?? [])].find((item) => item.kind === 'file');
  if (!dropped) return false;

  const file = dropped.getAsFile();
  toast.error((file && refusalFor(file, limits)) ?? NOT_ACCEPTED);
  return true;
}
