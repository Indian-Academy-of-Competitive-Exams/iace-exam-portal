import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Upload } from 'lucide-react';
import { DOCUMENT_MAX_BYTES, acceptedTypesFor, type DocumentKind, type Me } from '@iace/contracts';
import { Button, linkVariants } from '@iace/ui';
import { api } from '../lib/api';
import { ME_QUERY_KEY } from '../lib/constants';

/**
 * One uploadable thing: a photo, an Aadhaar, a PAN.
 *
 * The card always says which of the two states it is in — held, or not held —
 * because "did that upload work?" is the only question a student has here, and
 * a screen that answers it with silence sends them to the office to ask.
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
      // The response IS the refreshed profile, so the card can show the new
      // file without a second request — and the identity carries
      // profileCompleted, which this upload may have just changed.
      queryClient.setQueryData(ME_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const accepted = acceptedTypesFor(kind);
  const accept = accepted.join(',');

  /**
   * Said before they choose, not after it is refused.
   *
   * The limit and the accepted types were only enforced server-side, so the
   * first a student heard of either was an error message about a file they had
   * already waited to upload.
   */
  const rules = `${accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ')} · up to ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB`;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {url ? (
          <span className="flex items-center gap-1 text-xs text-success-ink">
            <Check className="size-3.5" aria-hidden />
            On file
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not added</span>
        )}
      </div>

      {url ? (
        // Opens a short-lived signed link. New tab, because a PDF would
        // otherwise navigate the student out of their own portal.
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={linkVariants({ variant: 'inline' })}
        >
          <span className="flex items-center gap-1 text-xs">
            <FileText className="size-3.5" aria-hidden />
            View what we hold
          </span>
        </a>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the SAME file again still fires — a student who
          // just rotated the photo and saved over it expects it to re-upload.
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />

      <Button
        variant="outline"
        size="sm"
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

      <p className="text-[11px] leading-tight text-muted-foreground">{rules}</p>
    </div>
  );
}
