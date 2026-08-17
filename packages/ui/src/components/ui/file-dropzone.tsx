import * as React from 'react';
import { FileUp } from 'lucide-react';
import { cn } from '../../lib/utils';

/** KB below a megabyte, MB above it. */
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
  /** What is acceptable, said before they choose — ".xlsx or .csv". */
  hint: string;
  /** The call to action while nothing is chosen. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Names the control for a screen reader, which never sees the visible copy. */
  'aria-label'?: string;
}

/** Choose a file, or drop one on it. */
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
    // The input is inside the label, so the association needs no htmlFor.
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-6 text-center text-sm transition-colors',
        // The ring goes on the label: the input carrying it is sr-only.
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
          // Cleared so choosing the same file twice still fires `change`.
          event.target.value = '';
        }}
      />
    </label>
  );
}
