import { Image } from '@tiptap/extension-image';
import { type EditorView } from '@tiptap/pm/view';
import { type Editor } from '@tiptap/react';
import { toast } from './toast';

/** What the app does with the bytes. `packages/ui` carries no api client, so this is passed in. */
export type UploadImage = (file: File) => Promise<{ key: string; url: string }>;

/** `data-key` is durable and `src` is per-session: the server strips src, so no image can rot. */
export const QuestionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-key': { default: null },
    };
  },

  /** A figure carries its own way out: nothing on screen said Backspace would do it. */
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const figure = document.createElement('span');
      figure.className = 'rich-figure';

      const image = document.createElement('img');
      for (const [name, value] of Object.entries(node.attrs)) {
        const text = asAttribute(value);
        if (text !== null) image.setAttribute(name, text);
      }
      figure.append(image);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rich-figure-remove';
      remove.title = REMOVE_IMAGE;
      remove.setAttribute('aria-label', REMOVE_IMAGE);
      remove.textContent = '\u00d7';
      // mousedown, not click: ProseMirror would otherwise move the selection out from under it.
      remove.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const at = getPos();
        if (at === undefined) return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: at, to: at + node.nodeSize })
          .run();
      });
      figure.append(remove);

      return { dom: figure };
    };
  },
});

const REMOVE_IMAGE = 'Remove image';

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

/** Uploads first, then inserts — so the node is born holding a key rather than acquiring one. */
export function insertUploaded(
  editor: Editor,
  file: File,
  upload: UploadImage,
  limits: ImageLimits = {},
): void {
  insertUploadedInto(editor.view, file, upload, limits);
}

/** The same against the view: paste and drop hold only that, and `view.editor` is undefined. */
export function insertUploadedInto(
  view: EditorView,
  file: File,
  upload: UploadImage,
  limits: ImageLimits = {},
): void {
  const refusal = refusalFor(file, limits);
  if (refusal) {
    toast.error(refusal);
    return;
  }

  // A rejection here was silently swallowed: the server refused the file and nothing said so.
  void upload(file)
    .then(({ key, url }) => {
      const type = view.state.schema.nodes.image;
      if (!type) throw new Error('This field does not take images');
      view.focus();
      view.dispatch(view.state.tr.replaceSelectionWith(type.create({ src: url, 'data-key': key })));
    })
    .catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'That image could not be uploaded'),
    );
}
