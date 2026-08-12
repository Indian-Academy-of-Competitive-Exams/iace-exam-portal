import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Upload } from 'lucide-react';
import { acceptedTypesFor, type DocumentKind, type Me } from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import { Alert, Button, linkVariants } from '@iace/ui';
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
  const [justSaved, setJustSaved] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => api.me.uploadDocument(kind, file),
    onSuccess: (me: Me) => {
      // The response IS the refreshed profile, so the card can show the new
      // file without a second request — and the identity carries
      // profileCompleted, which this upload may have just changed.
      queryClient.setQueryData(ME_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      setJustSaved(true);
    },
  });

  const accept = acceptedTypesFor(kind).join(',');

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
          if (file) {
            setJustSaved(false);
            upload.mutate(file);
          }
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
        {url ? 'Replace' : 'Upload'}
      </Button>

      {upload.error ? <Alert variant="danger">{bannerMessage(upload.error)}</Alert> : null}
      {justSaved && !upload.error ? <Alert variant="success">Saved.</Alert> : null}
    </div>
  );
}
