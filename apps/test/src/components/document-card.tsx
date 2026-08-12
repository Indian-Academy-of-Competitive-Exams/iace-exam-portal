import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, ImageOff, Loader2, Upload } from 'lucide-react';
import { DOCUMENT_MAX_BYTES, acceptedTypesFor, type DocumentKind, type Me } from '@iace/contracts';
import { Button, cn } from '@iace/ui';
import { api } from '../lib/api';
import { ME_QUERY_KEY } from '../lib/constants';

/**
 * One uploadable thing: a photo, an Aadhaar, a PAN.
 *
 * Built as a fixed column — preview, name, button, rules — so three of them
 * side by side line up whatever each one holds. Left to flow, a card holding a
 * document and one holding nothing came out different heights, and a row of
 * them stepped down the page.
 *
 * The preview IS the link. Someone checking what we hold should be able to
 * click the thing they are looking at, rather than find a line of text beside
 * it.
 */
export function DocumentCard({
  kind,
  label,
  url,
}: Readonly<{ kind: DocumentKind; label: string; url: string | null }>) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    meta: { success: `${label} saved.` },
    mutationFn: (file: File) => api.me.uploadDocument(kind, file),
    onSuccess: (me: Me) => {
      // The response IS the refreshed profile, so the card shows the new file
      // without a second request — and the identity carries profileCompleted,
      // which this upload may have just changed.
      queryClient.setQueryData(ME_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const accepted = acceptedTypesFor(kind);
  const megabytes = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);
  // Said before they choose, not after it is refused.
  const rules = `${accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ')} · up to ${megabytes}MB`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <Preview url={url} label={label} />

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        {url ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-success-ink">
            <Check className="size-3.5" aria-hidden />
            On file
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Not added</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accepted.join(',')}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the SAME file again still fires — someone who
          // just rotated the photo and saved over it expects it to re-upload.
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {upload.isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Upload aria-hidden />
        )}
        {/* Named for what it does to what is already there — "Upload" over an
            existing document reads as "add a second one". */}
        {url ? 'Replace this' : 'Upload'}
      </Button>

      {/* mt-auto so this sits on the floor of every card, however tall the rest
          of that card turned out. */}
      <p className="mt-auto text-[11px] leading-tight text-muted-foreground">{rules}</p>
    </div>
  );
}

/**
 * The container the file lives in.
 *
 * A fixed aspect box, the same size whether it holds a photo, a PDF or nothing
 * — which is what keeps a row of cards aligned. An image is shown; a PDF cannot
 * be, so it says so rather than rendering a broken frame.
 */
function Preview({ url, label }: Readonly<{ url: string | null; label: string }>) {
  const shell =
    'flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border';

  if (!url) {
    return (
      <div className={cn(shell, 'border-dashed border-border bg-muted/40 text-muted-foreground')}>
        <span className="flex flex-col items-center gap-1 text-xs">
          <ImageOff className="size-5" aria-hidden />
          Nothing uploaded
        </span>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      // noreferrer as well as noopener: the signed URL is in the address, and a
      // Referer header would hand it to whatever the new tab loads next.
      rel="noopener noreferrer"
      aria-label={`Open ${label} in a new tab`}
      className={cn(
        shell,
        'border-border bg-muted/40 transition-colors hover:border-ring',
        'focus-visible:shadow-focus focus-visible:outline-none',
      )}
    >
      {isPdf(url) ? (
        <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <FileText className="size-6" aria-hidden />
          PDF — open to view
        </span>
      ) : (
        <img src={url} alt={label} className="size-full object-cover" />
      )}
    </a>
  );
}

/**
 * Whether the stored object is a PDF.
 *
 * Read from the key's extension inside the signed URL, which is ours: the key
 * is built from the VERIFIED content type on upload, so the extension is a fact
 * about the bytes rather than something a browser claimed. The query string is
 * dropped first — it is full of signature characters, and matching ".pdf"
 * against the whole URL would eventually hit one by accident.
 */
function isPdf(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path.toLowerCase().endsWith('.pdf');
}
