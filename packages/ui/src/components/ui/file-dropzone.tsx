import * as React from 'react';
import { FileUp } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A file size a person can read at a glance.
 *
 * KB up to a megabyte, MB above it — "15000 KB" is a number the reader has to
 * do arithmetic on before it means anything. One decimal on MB, none on KB,
 * because the point is the order of magnitude and not the exact byte count.
 */
export function formatFileSize(bytes: number): string {
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

export interface FileDropzoneProps {
  /** The `accept` attribute — extensions, MIME types, or both, comma-joined. */
  accept: string;
  /** The chosen file, owned by the caller so it can preview or upload it. */
  file: File | null;
  /** `undefined` when the picker was dismissed without a choice. */
  onFileChange: (file: File | undefined) => void;
  /**
   * What is acceptable, said BEFORE they choose — ".xlsx or .csv", "JPG or PNG
   * up to 5MB". A rule the reader only meets as a rejection is a rule we chose
   * not to tell them.
   */
  hint: string;
  /** The call to action while nothing is chosen. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Names the control for a screen reader, which never sees the visible copy. */
  'aria-label'?: string;
}

/**
 * Choose a file, or drop one on it.
 *
 * The same twenty lines sat in both import screens — the dashed frame, the
 * swap from prompt to filename, the size line, and the one non-obvious bit
 * below (clearing `value` so the same file can be chosen twice). Two copies of
 * a control is two places for it to drift, and the drift here is invisible:
 * both looked fine, and only one of them would have been fixed.
 *
 * Dropping works as well as clicking. An import screen is somewhere people
 * arrive with a file already in hand, and dragging it in is the shortest path
 * between the two — it was simply never wired up.
 */
export function FileDropzone({
  accept,
  file,
  onFileChange,
  hint,
  label = 'Choose a file',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: Readonly<FileDropzoneProps>) {
  const [dragging, setDragging] = React.useState(false);

  const stop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    // The input is INSIDE the label, so the association is implicit and needs
    // no htmlFor — it is only visually hidden, not removed.
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-6 text-center text-sm transition-colors',
        // The ring is on the label because the input it belongs to is
        // sr-only — without this the control could be tabbed to and focused
        // with nothing on screen saying so.
        'focus-within:border-ring focus-within:shadow-focus',
        dragging
          ? 'border-ring bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:border-ring hover:text-foreground',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onDragEnter={(event) => {
        stop(event);
        setDragging(true);
      }}
      onDragOver={stop}
      onDragLeave={(event) => {
        stop(event);
        setDragging(false);
      }}
      onDrop={(event) => {
        stop(event);
        setDragging(false);
        if (!disabled) onFileChange(event.dataTransfer.files[0]);
      }}
    >
      <FileUp className="size-5" aria-hidden />
      <span className="font-medium text-foreground">{file ? file.name : label}</span>
      <span className="text-xs">
        {file ? `${formatFileSize(file.size)} — choose another to replace it` : hint}
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={(event) => {
          onFileChange(event.target.files?.[0]);
          // Cleared so choosing the SAME file again still fires. Whoever is
          // re-picking has usually just fixed the file and saved over the top,
          // and a picker that ignores that looks broken.
          event.target.value = '';
        }}
      />
    </label>
  );
}
