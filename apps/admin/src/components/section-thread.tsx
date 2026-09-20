import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, MessageSquare, Pencil, Send, X } from 'lucide-react';
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

const PANEL = 'w-[--modal-w-md]';

const SAID_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const sectionThreadKey = (testId: string, sectionId: string) =>
  [...QUERY_KEYS.SECTION_THREAD, testId, sectionId] as const;

/** What a message is being written as: a new one, or a rewording of one already said. */
interface Composing {
  body: string;
  images: string[];
  editingId: string | null;
}

const BLANK: Composing = { body: '', images: [], editingId: null };

export function SectionThreadButton({
  testId,
  sectionId,
  canWrite,
}: Readonly<{ testId: string; sectionId: string; canWrite: boolean }>) {
  const [open, setOpen] = useState(false);

  const thread = useQuery({
    queryKey: sectionThreadKey(testId, sectionId),
    queryFn: () => api.admin.assignments.comments(testId, sectionId),
  });
  const count = thread.data?.length ?? 0;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquare aria-hidden />
        {count > 0 ? `Comments (${count})` : 'Comments'}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" aria-describedby={undefined} className={PANEL}>
          <div className="mb-4 flex shrink-0 items-baseline gap-3 border-b border-border pb-3">
            <SheetTitle>Comments</SheetTitle>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              {thread.data ? plural(count, 'comment') : ''}
            </span>
            <SheetClose asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close comments">
                <X aria-hidden />
              </Button>
            </SheetClose>
          </div>

          <Thread testId={testId} sectionId={sectionId} canWrite={canWrite} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The same conversation inline, for the assign step's row panel, which has no sheet to open. */
export function SectionThread(
  props: Readonly<{ testId: string; sectionId: string; canWrite: boolean }>,
) {
  return (
    <div className="flex h-96 flex-col">
      <Thread {...props} />
    </div>
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
        ? api.admin.assignments.comment(testId, sectionId, { body, images })
        : api.admin.assignments.editComment(testId, sectionId, editingId, { body, images }),
    onSuccess: settle,
  });

  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [rows.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
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
          <EmptyState kind={EMPTY_STATE_KINDS.EMPTY} size="sm" level={3} title="Nothing said yet" />
        ) : null}

        {rows.map((comment) => (
          <Message
            key={comment.id}
            comment={comment}
            mine={comment.authorId === identity?.id}
            onReword={() =>
              setComposing({
                body: comment.body,
                images: [],
                editingId: comment.id,
              })
            }
          />
        ))}

        <div ref={foot} />
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
  onReword,
}: Readonly<{ comment: SectionComment; mine: boolean; onReword: () => void }>) {
  return (
    <div className={cn('flex items-start gap-2', mine && 'flex-row-reverse')}>
      <Avatar name={comment.authorName} size="sm" />

      <div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1', mine && 'items-end')}>
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{comment.authorName}</span>
          <span>{ADMIN_ROLE_LABELS[comment.authorRole]}</span>
          <span>{SAID_AT.format(new Date(comment.createdAt))}</span>
          {comment.editedAt ? <EditedMark comment={comment} /> : null}
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

        {mine ? (
          <Button variant="ghost" size="sm" onClick={onReword}>
            <Pencil aria-hidden />
            Reword
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The trail is why rewording is allowed at all, so it is on the message rather than behind a screen. */
function EditedMark({ comment }: Readonly<{ comment: SectionComment }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted">edited</span>
      </TooltipTrigger>
      <TooltipContent>
        {comment.revisions.map((revision) => revision.body).join(' — then — ') || 'Reworded'}
      </TooltipContent>
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
      onChange({ ...composing, images: [...composing.images, image.key] });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
      {composing.editingId ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Rewording a comment</span>
          <Button variant="ghost" size="sm" onClick={() => onChange(BLANK)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {composing.images.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          {plural(composing.images.length, 'picture')} attached
        </span>
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

        <label className="shrink-0">
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
