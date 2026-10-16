import * as React from 'react';
import { ImagePlus, Send, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Avatar } from './avatar';
import { Button } from './button';
import { Textarea } from './textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/** One picture waiting to be sent: the key goes to the server, the url shows it meanwhile. */
export interface ThreadAttachment {
  key: string;
  url: string;
}

/** What a message is being written as: a new one, or an edit of one already said. */
export interface ThreadDraft {
  body: string;
  images: ThreadAttachment[];
  editingId: string | null;
}

export const BLANK_THREAD_DRAFT: ThreadDraft = { body: '', images: [], editingId: null };

/** The updater an upload lands with: a draft turned into an edit meanwhile keeps its pictures as they are. */
export const withThreadImage =
  (image: ThreadAttachment) =>
  (current: ThreadDraft): ThreadDraft =>
    current.editingId === null ? { ...current, images: [...current.images, image] } : current;

const BUBBLE_TONE = {
  mine: 'border-primary/30 bg-primary/[0.08]',
  theirs: 'border-border bg-surface',
  warning: 'border-warning/40 bg-warning-subtle',
} as const;

/** One said thing in a thread: who, when, the words and any pictures; `aside` trails the byline. */
export function ThreadMessage({
  authorName,
  label,
  at,
  body,
  images,
  mine,
  tone,
  aside,
  children,
}: Readonly<{
  authorName: string | null;
  label?: string;
  /** Already formatted: the time zone is the app's to choose, never this package's. */
  at: string;
  body: string;
  images: readonly string[];
  mine: boolean;
  tone?: 'warning';
  aside?: React.ReactNode;
  children?: React.ReactNode;
}>) {
  return (
    <div className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
      <Avatar name={authorName} size="sm" />

      <div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1', mine && 'items-end')}>
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground',
            mine && 'flex-row-reverse',
          )}
        >
          <span className="font-medium text-foreground">{authorName}</span>
          {label ? <span>{label}</span> : null}
          <span>{at}</span>
          {aside}
        </div>

        <div
          className={cn(
            'flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm',
            BUBBLE_TONE[tone ?? (mine ? 'mine' : 'theirs')],
          )}
        >
          {body ? <p className="whitespace-pre-wrap break-words">{body}</p> : null}

          {images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" aria-label="Open picture">
              <img src={url} alt="" className="max-h-64 rounded-md border border-border" />
            </a>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}

export interface ThreadComposerProps {
  composing: ThreadDraft;
  sending: boolean;
  /** The writer's avatar; omitted, the box stands alone. */
  name?: string | null;
  /** An updater, never a value: a picture lands after the render that picked it has gone stale. */
  onChange: React.Dispatch<React.SetStateAction<ThreadDraft>>;
  onSend: () => void;
  /** Omitted, no picture can be added. The caller uploads and lands it with `withThreadImage`. */
  onPickImage?: (file: File) => void;
  uploading?: boolean;
  /** The file input's `accept`, comma-joined MIME types. */
  accept?: string;
  maxImages?: number;
  placeholder: string;
  head?: React.ReactNode;
  /** Keeps the words in the box but takes nothing more from it. */
  disabled?: boolean;
  /** Send waits for words even when a picture is attached. */
  requireText?: boolean;
  className?: string;
}

export function ThreadComposer({
  composing,
  sending,
  name,
  onChange,
  onSend,
  onPickImage,
  uploading = false,
  accept,
  maxImages = 1,
  placeholder,
  head,
  disabled = false,
  requireText = false,
  className,
}: Readonly<ThreadComposerProps>) {
  const editing = composing.editingId !== null;
  const noText = composing.body.trim() === '';
  const empty = noText && (requireText || composing.images.length === 0);

  return (
    <div className={cn('flex shrink-0 flex-col gap-2 border-t border-border pt-3', className)}>
      {head}

      {editing ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Editing a comment. Its pictures stay as they are.</span>
          <Button variant="ghost" size="sm" onClick={() => onChange(BLANK_THREAD_DRAFT)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {composing.images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {composing.images.map((image) => (
            <li key={image.key} className="relative">
              <img
                src={image.url}
                alt=""
                className="size-16 rounded-md border border-border object-cover"
              />
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Remove this picture"
                className="absolute -right-2 -top-2 bg-surface"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    images: current.images.filter((held) => held.key !== image.key),
                  }))
                }
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        {name === undefined ? null : <Avatar name={name} size="sm" />}

        <Textarea
          value={composing.body}
          onChange={(event) => {
            const body = event.target.value;
            onChange((current) => ({ ...current, body }));
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={2}
          className="min-h-0 flex-1 resize-none"
        />

        {onPickImage ? (
          <label className="relative shrink-0">
            <span className="sr-only">Add a picture</span>
            <input
              type="file"
              className="peer sr-only"
              accept={accept}
              disabled={disabled || editing || uploading || composing.images.length >= maxImages}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPickImage(file);
                event.target.value = '';
              }}
            />
            <span
              className={cn(
                'inline-flex size-9 items-center justify-center rounded-md border border-border',
                'cursor-pointer text-muted-foreground hover:bg-muted peer-focus-visible:shadow-focus',
                'peer-disabled:pointer-events-none peer-disabled:border-disabled-border peer-disabled:bg-disabled peer-disabled:text-disabled-foreground',
              )}
            >
              <ImagePlus className="size-4" aria-hidden />
            </span>
          </label>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              loading={sending}
              disabled={disabled || empty || uploading}
              onClick={onSend}
              aria-label="Send"
            >
              <Send aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Send</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
