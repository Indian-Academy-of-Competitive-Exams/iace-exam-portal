import { Image } from '@tiptap/extension-image';
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
});

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
  const refusal = refusalFor(file, limits);
  if (refusal) {
    toast.error(refusal);
    return;
  }

  // A rejection here was silently swallowed: the server refused the file and nothing said so.
  void upload(file)
    .then(({ key, url }) =>
      editor
        .chain()
        .focus()
        .setImage({ src: url, 'data-key': key } as never)
        .run(),
    )
    .catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'That image could not be uploaded'),
    );
}
