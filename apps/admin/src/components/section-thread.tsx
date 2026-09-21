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
import { useAuth } from '../providers/auth';
import { ADMIN_ROLE_LABELS, QUERY_KEYS } from '../lib/constants';

/** The discussion on one (test, section) — spec §9, read as a conversation rather than a log. */

const PANEL = 'w-[--modal-w-lg]';

const SAID_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const sectionThreadKey = (testId: string, sectionId: string) =>
  [...QUERY_KEYS.SECTION_THREAD, testId, sectionId] as const;

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

  const thread = useQuery({
    queryKey: sectionThreadKey(testId, sectionId),
    queryFn: () => api.admin.assignments.comments(testId, sectionId),
  });
  const rows = thread.data ?? [];

  const settle = async () => {
    setComposing(BLANK);
    await queryClient.invalidateQueries({ queryKey: sectionThreadKey(testId, sectionId) });
  };

  const say = useMutation({
    mutationFn: ({ body, images, editingId }: Composing) =>
      editingId === null
        ? api.admin.assignments.comment(testId, sectionId, {
            body,
            images: images.map((image) => image.key),
          })
        : api.admin.assignments.editComment(testId, sectionId, editingId, { body }),
    onSuccess: settle,
  });

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
              onEdit={() => setComposing({ body: comment.body, images: [], editingId: comment.id })}
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
    </div>
  );
}

function Message({
  comment,
  mine,
  onEdit,
}: Readonly<{ comment: SectionComment; mine: boolean; onEdit: () => void }>) {
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
          {mine ? (
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
  onChange: (next: Composing) => void;
  onSend: () => void;
}>) {
  const [uploading, setUploading] = useState(false);
  const empty = composing.body.trim() === '' && composing.images.length === 0;

  const add = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const image = await api.admin.questions.uploadImage(file);
      onChange({ ...composing, images: [...composing.images, image] });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
      {composing.editingId ? (
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
                  onChange({
                    ...composing,
                    images: composing.images.filter((held) => held.key !== image.key),
                  })
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
          onChange={(event) => onChange({ ...composing, body: event.target.value })}
          placeholder="Write a comment"
          aria-label="Write a comment"
          rows={2}
          className="min-h-0 flex-1 resize-none"
        />

        <label className="relative shrink-0">
          <span className="sr-only">Add a picture</span>
          <input
            type="file"
            className="sr-only"
            accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
            disabled={uploading || composing.images.length >= COMMENT_MAX_IMAGES}
            onChange={(event) => {
              void add(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <span
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-md border border-border',
              'cursor-pointer text-muted-foreground hover:bg-muted',
            )}
          >
            <ImagePlus className="size-4" aria-hidden />
          </span>
        </label>

        <Button size="icon" loading={sending} disabled={empty} onClick={onSend} aria-label="Send">
          <Send aria-hidden />
        </Button>
      </div>
    </div>
  );
}
