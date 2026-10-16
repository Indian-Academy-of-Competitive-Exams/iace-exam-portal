import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { PageCrumbs, shrunkForUpload } from '@iace/app-kit/browser';
import {
  Alert,
  BLANK_THREAD_DRAFT,
  Button,
  ConfirmDialog,
  EMPTY_STATE_KINDS,
  EmptyState,
  PageFrame,
  PageHeader,
  ThreadComposer,
  ThreadMessage,
  withThreadImage,
  type ThreadDraft,
} from '@iace/ui';
import { RowsSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS, ROUTES, SUPPORT_QUERY_KEY, supportTicketQueryKey } from '../../lib/constants';

const STAFF_NAME = 'IACE';
const OWN_NAME = 'You';

export function QueryThreadPage() {
  const { ticketId = '' } = useParams();
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

  const label = ticket ? SUPPORT_CATEGORY_INFO[ticket.category].label : 'Query';
  const closed = ticket?.status === SUPPORT_STATUSES.CLOSED;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label }]} />}
          title={label}
          meta={ticket ? SUPPORT_STATUS_STUDENT_LABEL[ticket.status] : undefined}
          action={
            ticket && !closed ? (
              <Button
                variant="outline"
                size="sm"
                icon={<Lock aria-hidden />}
                onClick={() => setClosing(true)}
              >
                Close query
              </Button>
            ) : undefined
          }
        />
      }
      footer={ticket ? <Footer ticket={ticket} onSent={settle} /> : null}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {detail.isPending ? <RowsSkeleton /> : null}

        {detail.isError && !ticket ? (
          <EmptyState
            kind={EMPTY_STATE_KINDS.FAILURE}
            title="Could not load this query"
            onRetry={detail.refetch}
          />
        ) : null}

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
    </PageFrame>
  );
}

const ClosedAlert = () => (
  <Alert variant="info">
    <span>
      This query is closed.{' '}
      <Link to={ROUTES.HELP_NEW} className="font-medium underline">
        Raise a new query
      </Link>
    </span>
  </Alert>
);

const isClosedRefusal = (error: unknown) =>
  AppException.is(error) && error.code === ErrorCodes.TICKET_CLOSED;

/** One optional picture a message: the server takes a single attachment key. */
function Footer({
  ticket,
  onSent,
}: Readonly<{ ticket: TicketDetail; onSent: (fresh: TicketDetail) => Promise<unknown> }>) {
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
    return (
      <div className="mx-auto w-full max-w-3xl pt-4">
        <ClosedAlert />
      </div>
    );
  }

  return (
    <ThreadComposer
      className="mx-auto w-full max-w-3xl"
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
          {refusedClosed ? <ClosedAlert /> : null}
          {failure ? <Alert variant="danger">{failure}</Alert> : null}
        </>
      }
    />
  );
}
