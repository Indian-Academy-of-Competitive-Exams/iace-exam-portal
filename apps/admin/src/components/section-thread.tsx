import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, X } from 'lucide-react';
import {
  COMMENT_MAX_IMAGES,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  type SectionComment,
} from '@iace/contracts';
import {
  BLANK_THREAD_DRAFT,
  Button,
  ConfirmDialog,
  EmptyState,
  EMPTY_STATE_KINDS,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SkeletonParagraph,
  ThreadComposer,
  ThreadMessage,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  plural,
  withThreadImage,
  type ThreadDraft,
} from '@iace/ui';
import { api } from '../lib/api';
import { uploadQuestionImage } from '../lib/upload-question-image';
import { useAuth } from '../providers/auth';
import { ADMIN_ROLE_LABELS } from '../lib/labels';
import { sectionThreadQueryKey } from '../lib/query-keys';
import { saidAt } from '../lib/said-at';

/** The discussion on one (test, section) — spec §9, read as a conversation rather than a log. */

const PANEL = 'w-[--modal-w-lg]';

/** How much of an unsent comment a confirm quotes back before it is dropped. */
const UNSENT_QUOTE_CHARS = 80;

/** What the box holds unsent, named for the confirm that would drop it. */
function unsentOf({ body, images }: ThreadDraft): string {
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
  const [composing, setComposing] = useState<ThreadDraft>(BLANK_THREAD_DRAFT);
  const [replacing, setReplacing] = useState<SectionComment | null>(null);

  const thread = useQuery({
    queryKey: sectionThreadQueryKey(testId, sectionId),
    queryFn: () => api.admin.sectionWork.comments(testId, sectionId),
  });
  const rows = thread.data ?? [];

  const settle = async () => {
    setComposing(BLANK_THREAD_DRAFT);
    await queryClient.invalidateQueries({ queryKey: sectionThreadQueryKey(testId, sectionId) });
  };

  const say = useMutation({
    mutationFn: ({ body, images, editingId }: ThreadDraft) =>
      editingId === null
        ? api.admin.sectionWork.comment(testId, sectionId, {
            body,
            images: images.map((image) => image.key),
          })
        : api.admin.sectionWork.editComment(testId, sectionId, editingId, { body }),
    onSuccess: settle,
  });

  // A mutation, so a picture the server refuses is announced like any other failed write.
  const upload = useMutation({
    mutationFn: uploadQuestionImage,
    onSuccess: (image) => setComposing(withThreadImage(image)),
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
            <ThreadMessage
              key={comment.id}
              authorName={comment.authorName}
              label={ADMIN_ROLE_LABELS[comment.authorRole]}
              at={saidAt(comment.createdAt)}
              body={comment.body}
              images={comment.images}
              mine={comment.authorId === identity?.id}
              aside={
                <>
                  {comment.editedAt ? <EditedMark comment={comment} /> : null}
                  {/* The server takes a reword only from its author, and only while they may still write here. */}
                  {canWrite && comment.authorId === identity?.id ? (
                    <button
                      type="button"
                      onClick={() => (unsent ? setReplacing(comment) : edit(comment))}
                      className="underline decoration-dotted hover:text-foreground"
                    >
                      Edit
                    </button>
                  ) : null}
                </>
              }
            />
          ))}

          <div ref={foot} />
        </div>
      </div>

      {canWrite ? (
        <ThreadComposer
          composing={composing}
          sending={say.isPending}
          name={identity?.fullName ?? null}
          onChange={setComposing}
          onSend={() => say.mutate(composing)}
          onPickImage={(file) => upload.mutate(file)}
          uploading={upload.isPending}
          accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
          maxImages={COMMENT_MAX_IMAGES}
          placeholder="Write a comment"
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
