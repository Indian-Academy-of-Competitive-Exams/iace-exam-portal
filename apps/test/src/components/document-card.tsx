import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, ImageOff, Upload } from 'lucide-react';
import {
  ACCEPTED_TYPES_FOR,
  DOCUMENT_MAX_BYTES,
  type DocumentKind,
  type Me,
} from '@iace/contracts';
import { Button, cn } from '@iace/ui';
import { api } from '../lib/api';
import { ME_QUERY_KEY, PROFILE_QUERY_KEY } from '../lib/constants';

/** One uploadable thing, at a fixed width so it never grows with the page. The preview IS the link. */
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
      // The response IS the refreshed profile, so no second request is needed.
      queryClient.setQueryData(PROFILE_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  const accepted = ACCEPTED_TYPES_FOR[kind];
  const megabytes = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);
  // Said before they choose, not after it is refused.
  const rules = `${accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ')} · up to ${megabytes}MB`;

  return (
    // Keyed on the file input, not the button: the button is also disabled mid-upload.
    <div
      className={cn(
        'flex w-56 flex-col gap-3 rounded-md border border-border p-3',
        'has-[input:disabled]:border-disabled-border has-[input:disabled]:bg-disabled',
      )}
    >
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
        icon={<Upload aria-hidden />}
        loading={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {/* Named for what it does to what is already there — "Upload" over an
            existing document reads as "add a second one". */}
        {url ? 'Replace this' : 'Upload'}
      </Button>

      {/* mt-auto so this sits on the floor of every card, however tall the rest
          of that card turned out. */}
      <p className="mt-auto text-2xs leading-tight text-muted-foreground">{rules}</p>
    </div>
  );
}

/** A fixed aspect box, the same size whether it holds a photo, a PDF or nothing. */
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
 * From the key's extension, which we built from the verified content type on upload.
 * The query string is dropped first: its signature characters would eventually match.
 */
function isPdf(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path.toLowerCase().endsWith('.pdf');
}
