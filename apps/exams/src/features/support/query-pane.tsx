import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_STUDENT_LABEL,
  instituteDateTimeLabel,
  type TicketDetail,
} from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import { shrunkForUpload } from '@iace/app-kit/browser';
import {
  Alert,
  BLANK_THREAD_DRAFT,
  Badge,
  Button,
  ConfirmDialog,
  EMPTY_STATE_KINDS,
  EmptyState,
  SkeletonParagraph,
  ThreadComposer,
  ThreadMessage,
  TruncatedText,
  withThreadImage,
  type ThreadDraft,
} from '@iace/ui';
import { api } from '../../lib/api';
import {
  SUPPORT_QUERY_KEY,
  SUPPORT_STATUS_BADGE,
  supportTicketQueryKey,
} from '../../lib/constants';

const STAFF_NAME = 'IACE';
const OWN_NAME = 'You';

/** One query's thread, held beside the list: its head, the messages scrolling, the reply box pinned. */
export function QueryPane({
  ticketId,
  onRaise,
}: Readonly<{ ticketId: string; onRaise: () => void }>) {
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);

  const detail = useQuery({
    queryKey: supportTicketQueryKey(ticketId),
    queryFn: () => api.me.support.detail(ticketId),
  });
  const ticket = detail.data;

  const settle = (fresh: TicketDetail) => {
    queryClient.setQueryData(supportTicketQueryKey(ticketId), fresh);
    return queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY });
  };

  const close = useMutation({
    mutationFn: () => api.me.support.close(ticketId),
    onSuccess: async (fresh) => {
      setClosing(false);
      await settle(fresh);
    },
  });

  const foot = useRef<HTMLDivElement>(null);
  const messageCount = ticket?.messages.length ?? 0;
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  if (detail.isError && !ticket) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        size="sm"
        title="Could not load this query"
        onRetry={detail.refetch}
      />
    );
  }

  return (
    <>
      {ticket ? (
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="min-w-0 font-semibold">
              <TruncatedText>
                {ticket.title ?? SUPPORT_CATEGORY_INFO[ticket.category].label}
              </TruncatedText>
            </h2>
            <Badge variant={SUPPORT_STATUS_BADGE[ticket.status]} className="self-start">
              {SUPPORT_STATUS_STUDENT_LABEL[ticket.status]}
            </Badge>
          </div>
          {ticket.status === SUPPORT_STATUSES.CLOSED ? null : (
            <Button
              variant="outline"
              size="sm"
              icon={<Lock aria-hidden />}
              onClick={() => setClosing(true)}
            >
              Close query
            </Button>
          )}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        {/* mt-auto, never justify-end: a justified flex scroller clips its overflow out of reach. */}
        <div className="mt-auto flex flex-col gap-4">
          {detail.isPending ? <SkeletonParagraph lines={6} /> : null}
          {ticket?.messages.map((message) => (
            <ThreadMessage
              key={message.id}
              authorName={message.fromStaff ? STAFF_NAME : OWN_NAME}
              at={instituteDateTimeLabel(message.createdAt)}
              body={message.body}
              images={message.attachmentUrl ? [message.attachmentUrl] : []}
              mine={!message.fromStaff}
            />
          ))}
          <div ref={foot} />
        </div>
      </div>

      {ticket ? <Footer ticket={ticket} onSent={settle} onRaise={onRaise} /> : null}

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Close this query?"
        description="You can no longer reply to it. Anything further needs a new query."
        confirmLabel="Close query"
        icon={Lock}
        destructive
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      />
    </>
  );
}

const ClosedAlert = ({ onRaise }: Readonly<{ onRaise: () => void }>) => (
  <Alert variant="info">
    <span>
      This query is closed.{' '}
      <button type="button" className="font-medium underline" onClick={onRaise}>
        Raise a new query
      </button>
    </span>
  </Alert>
);

const isClosedRefusal = (error: unknown) =>
  AppException.is(error) && error.code === ErrorCodes.TICKET_CLOSED;

/** One optional picture a message: the server takes a single attachment key. */
function Footer({
  ticket,
  onSent,
  onRaise,
}: Readonly<{
  ticket: TicketDetail;
  onSent: (fresh: TicketDetail) => Promise<unknown>;
  onRaise: () => void;
}>) {
  const ticketId = ticket.id;
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState<ThreadDraft>(BLANK_THREAD_DRAFT);

  const upload = useMutation({
    mutationFn: async (file: File) => api.me.support.upload(ticketId, await shrunkForUpload(file)),
    onSuccess: (image) => setComposing(withThreadImage(image)),
  });

  const send = useMutation({
    // Silent: the alert above the box says it, so a toast would say it twice.
    meta: { silent: true },
    mutationFn: () =>
      api.me.support.reply(ticketId, {
        body: composing.body,
        attachmentKey: composing.images[0]?.key,
      }),
    onSuccess: async (fresh) => {
      setComposing(BLANK_THREAD_DRAFT);
      await onSent(fresh);
    },
    onError: (error) =>
      isClosedRefusal(error)
        ? queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY })
        : undefined,
  });

  // The words stay in the box, so a student whose query closed meanwhile can carry them over.
  const refusedClosed = isClosedRefusal(send.error);
  const failure = send.isError && !refusedClosed ? bannerMessage(send.error) : null;

  if (ticket.status === SUPPORT_STATUSES.CLOSED && !refusedClosed) {
    return <ClosedAlert onRaise={onRaise} />;
  }

  return (
    <ThreadComposer
      composing={composing}
      sending={send.isPending}
      onChange={setComposing}
      onSend={() => send.mutate()}
      onPickImage={(file) => upload.mutate(file)}
      uploading={upload.isPending}
      accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
      placeholder="Write a reply"
      requireText
      disabled={refusedClosed}
      head={
        <>
          {refusedClosed ? <ClosedAlert onRaise={onRaise} /> : null}
          {failure ? <Alert variant="danger">{failure}</Alert> : null}
        </>
      }
    />
  );
}
