import { Image } from '@tiptap/extension-image';
import { type Editor } from '@tiptap/react';

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

/** Uploads first, then inserts — so the node is born holding a key rather than acquiring one. */
export function insertUploaded(editor: Editor, file: File, upload: UploadImage): void {
  void upload(file).then(({ key, url }) =>
    editor
      .chain()
      .focus()
      .setImage({ src: url, 'data-key': key } as never)
      .run(),
  );
}
