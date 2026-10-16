/** One picture waiting to be sent: the key goes to the server, the url shows it meanwhile. */
export interface Attachment {
  key: string;
  url: string;
}

/** What a message is being written as: a new one, or an edit of one already said. */
export interface Composing {
  body: string;
  images: Attachment[];
  editingId: string | null;
}

export const BLANK: Composing = { body: '', images: [], editingId: null };
