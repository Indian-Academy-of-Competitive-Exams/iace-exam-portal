import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, MessageSquare, Send, X } from 'lucide-react';
import {
  COMMENT_MAX_IMAGES,
  INSTITUTE_TIME_ZONE,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  type SectionComment,
} from '@iace/contracts';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  EMPTY_STATE_KINDS,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SkeletonParagraph,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { uploadQuestionImage } from '../lib/upload-question-image';
import { useAuth } from '../providers/auth';
import { ADMIN_ROLE_LABELS, sectionThreadQueryKey } from '../lib/constants';

/** The discussion on one (test, section) — spec §9, read as a conversation rather than a log. */

const PANEL = 'w-[--modal-w-lg]';

const SAID_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** One picture waiting to be sent: the key goes to the server, the url shows it meanwhile. */
interface Attachment {
  key: string;
  url: string;
}

/** What a message is being written as: a new one, or an edit of one already said. */
interface Composing {
  body: string;
  images: Attachment[];
  editingId: string | null;
}

const BLANK: Composing = { body: '', images: [], editingId: null };

/** How much of an unsent comment a confirm quotes back before it is dropped. */
const UNSENT_QUOTE_CHARS = 80;

/** What the box holds unsent, named for the confirm that would drop it. */
function unsentOf({ body, images }: Composing): string {
  const words = body.trim();
  const cut = words.length > UNSENT_QUOTE_CHARS ? `${words.slice(0, UNSENT_QUOTE_CHARS)}…` : words;
  const named = [
    words ? `“${cut}”` : '',
    images.length > 0 ? plural(images.length, 'picture') : '',
  ];
  return named.filter(Boolean).join(' and ');
}

/** The button fetches nothing: ten sections on a page would be ten reads for a number. */
export function SectionThreadButton({
  testId,
  sectionId,
  canWrite,
}: Readonly<{ testId: string; sectionId: string; canWrite: boolean }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquare aria-hidden />
        Comments
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" aria-describedby={undefined} className={PANEL}>
          <Thread testId={testId} sectionId={sectionId} canWrite={canWrite} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Mounted only while the sheet is open, so nothing fetches behind a closed panel. */
function Thread({
  testId,
  sectionId,
  canWrite,
}: Readonly<{ testId: string; sectionId: string; canWrite: boolean }>) {
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState<Composing>(BLANK);
  const [replacing, setReplacing] = useState<SectionComment | null>(null);

  const thread = useQuery({
    queryKey: sectionThreadQueryKey(testId, sectionId),
    queryFn: () => api.admin.sectionWork.comments(testId, sectionId),
  });
  const rows = thread.data ?? [];

  const settle = async () => {
    setComposing(BLANK);
    await queryClient.invalidateQueries({ queryKey: sectionThreadQueryKey(testId, sectionId) });
  };

  const say = useMutation({
    mutationFn: ({ body, images, editingId }: Composing) =>
      editingId === null
        ? api.admin.sectionWork.comment(testId, sectionId, {
            body,
            images: images.map((image) => image.key),
          })
        : api.admin.sectionWork.editComment(testId, sectionId, editingId, { body }),
    onSuccess: settle,
  });

  const edit = (comment: SectionComment) =>
    setComposing({ body: comment.body, images: [], editingId: comment.id });
  // Unsent is a picture, or words that are not the comment being reworded as it already stands.
  const standing = rows.find((row) => row.id === composing.editingId)?.body ?? '';
  const unsent = composing.images.length > 0 || composing.body.trim() !== standing.trim();

  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [rows.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-baseline gap-3 border-b border-border pb-3">
        <SheetTitle>Comments</SheetTitle>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          {thread.data ? plural(rows.length, 'comment') : ''}
        </span>
        <SheetClose asChild>
          <Button variant="ghost" size="iconSm" aria-label="Close comments">
            <X aria-hidden />
          </Button>
        </SheetClose>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        {/* mt-auto, never justify-end: a justified flex scroller clips its overflow out of reach. */}
        <div className="mt-auto flex flex-col gap-4">
          {thread.isLoading ? <SkeletonParagraph lines={6} /> : null}

          {thread.isError ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              size="sm"
              level={3}
              title="Could not load the comments"
              onRetry={thread.refetch}
            />
          ) : null}

          {thread.data && rows.length === 0 ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.EMPTY}
              size="sm"
              level={3}
              title="Nothing said yet"
            />
          ) : null}

          {rows.map((comment) => (
            <Message
              key={comment.id}
              comment={comment}
              mine={comment.authorId === identity?.id}
              // The server takes a reword only from its author, and only while they may still write here.
              onEdit={
                canWrite && comment.authorId === identity?.id
                  ? () => (unsent ? setReplacing(comment) : edit(comment))
                  : undefined
              }
            />
          ))}

          <div ref={foot} />
        </div>
      </div>

      {canWrite ? (
        <Composer
          composing={composing}
          sending={say.isPending}
          name={identity?.fullName ?? null}
          onChange={setComposing}
          onSend={() => say.mutate(composing)}
        />
      ) : null}

      {replacing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setReplacing(null)}
          destructive
          title="Discard what is in the box?"
          description={`It has not been sent, and editing this comment drops it: ${unsentOf(composing)}.`}
          confirmLabel="Discard and edit"
          onConfirm={() => {
            edit(replacing);
            setReplacing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Message({
  comment,
  mine,
  onEdit,
}: Readonly<{
  comment: SectionComment;
  mine: boolean;
  /** Absent where the viewer could not reword it. */
  onEdit: (() => void) | undefined;
}>) {
  return (
    <div className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
      <Avatar name={comment.authorName} size="sm" />

      <div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1', mine && 'items-end')}>
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground',
            mine && 'flex-row-reverse',
          )}
        >
          <span className="font-medium text-foreground">{comment.authorName}</span>
          <span>{ADMIN_ROLE_LABELS[comment.authorRole]}</span>
          <span>{SAID_AT.format(new Date(comment.createdAt))}</span>
          {comment.editedAt ? <EditedMark comment={comment} /> : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="underline decoration-dotted hover:text-foreground"
            >
              Edit
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            'flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm',
            mine ? 'border-primary/30 bg-primary/[0.08]' : 'border-border bg-surface',
          )}
        >
          {comment.body ? <p className="whitespace-pre-wrap break-words">{comment.body}</p> : null}

          {comment.images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="" className="max-h-64 rounded-md border border-border" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The trail is why editing is allowed at all, so the last wording is one hover away. */
function EditedMark({ comment }: Readonly<{ comment: SectionComment }>) {
  const previous = comment.revisions.at(-1)?.body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted">edited</span>
      </TooltipTrigger>
      <TooltipContent>{previous ? `Before: ${previous}` : 'Edited'}</TooltipContent>
    </Tooltip>
  );
}

function Composer({
  composing,
  sending,
  name,
  onChange,
  onSend,
}: Readonly<{
  composing: Composing;
  sending: boolean;
  name: string | null;
  /** An updater, never a value: a picture lands after the render that picked it has gone stale. */
  onChange: React.Dispatch<React.SetStateAction<Composing>>;
  onSend: () => void;
}>) {
  const editing = composing.editingId !== null;
  const empty = composing.body.trim() === '' && composing.images.length === 0;

  // A mutation, so a picture the server refuses is announced like any other failed write.
  const upload = useMutation({
    mutationFn: uploadQuestionImage,
    onSuccess: (image) =>
      onChange((current) =>
        current.editingId === null ? { ...current, images: [...current.images, image] } : current,
      ),
  });

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
      {editing ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Editing a comment. Its pictures stay as they are.</span>
          <Button variant="ghost" size="sm" onClick={() => onChange(BLANK)}>
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
        <Avatar name={name} size="sm" />

        <Textarea
          value={composing.body}
          onChange={(event) => {
            const body = event.target.value;
            onChange((current) => ({ ...current, body }));
          }}
          placeholder="Write a comment"
          aria-label="Write a comment"
          rows={2}
          className="min-h-0 flex-1 resize-none"
        />

        <label className="relative shrink-0">
          <span className="sr-only">Add a picture</span>
          <input
            type="file"
            className="peer sr-only"
            accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
            disabled={editing || upload.isPending || composing.images.length >= COMMENT_MAX_IMAGES}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
          />
          <span
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-md border border-border',
              'cursor-pointer text-muted-foreground hover:bg-muted',
              'peer-disabled:pointer-events-none peer-disabled:border-disabled-border peer-disabled:bg-disabled peer-disabled:text-disabled-foreground',
            )}
          >
            <ImagePlus className="size-4" aria-hidden />
          </span>
        </label>

        <Button
          size="icon"
          loading={sending}
          disabled={empty || upload.isPending}
          onClick={onSend}
          aria-label="Send"
        >
          <Send aria-hidden />
        </Button>
      </div>
    </div>
  );
}
