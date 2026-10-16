import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Lock, Send, X } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUSES,
  instituteDateTimeLabel,
  type SupportAttachment,
  type SupportMessage,
  type TicketDetail,
} from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import { PageCrumbs, shrunkForUpload } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  ConfirmDialog,
  EMPTY_STATE_KINDS,
  EmptyState,
  PageFrame,
  PageHeader,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@iace/ui';
import { RowsSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import {
  NAV_ITEMS,
  ROUTES,
  SUPPORT_QUERY_KEY,
  SUPPORT_STATUS_LABEL,
  supportTicketQueryKey,
} from '../../lib/constants';

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
          meta={ticket ? SUPPORT_STATUS_LABEL[ticket.status] : undefined}
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
          <Bubble key={message.id} message={message} />
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

/** IACE on the left, the student on the right. */
function Bubble({ message }: Readonly<{ message: SupportMessage }>) {
  const mine = !message.fromStaff;

  return (
    <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', mine && 'self-end items-end')}>
      <div className="flex gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{mine ? OWN_NAME : STAFF_NAME}</span>
        <span>{instituteDateTimeLabel(message.createdAt)}</span>
      </div>
      <div
        className={cn(
          'flex flex-col gap-2 rounded-xl border px-4 py-3 text-base',
          mine ? 'border-primary/30 bg-primary-subtle' : 'border-border bg-surface',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        {message.attachmentUrl ? (
          <a href={message.attachmentUrl} target="_blank" rel="noreferrer">
            <img
              src={message.attachmentUrl}
              alt=""
              className="max-h-64 rounded-md border border-border"
            />
          </a>
        ) : null}
      </div>
    </div>
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

function Footer({
  ticket,
  onSent,
}: Readonly<{ ticket: TicketDetail; onSent: (fresh: TicketDetail) => Promise<unknown> }>) {
  if (ticket.status === SUPPORT_STATUSES.CLOSED) {
    return (
      <div className="mx-auto w-full max-w-3xl pt-4">
        <ClosedAlert />
      </div>
    );
  }
  return <Composer ticketId={ticket.id} onSent={onSent} />;
}

/** One optional picture a message: the server takes a single attachment key. */
function Composer({
  ticketId,
  onSent,
}: Readonly<{ ticketId: string; onSent: (fresh: TicketDetail) => Promise<unknown> }>) {
  const [body, setBody] = useState('');
  const [image, setImage] = useState<SupportAttachment | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => api.me.support.upload(ticketId, await shrunkForUpload(file)),
    onSuccess: setImage,
  });

  const send = useMutation({
    // Silent: the alert below the box says it, so a toast would say it twice.
    meta: { silent: true },
    mutationFn: () => api.me.support.reply(ticketId, { body, attachmentKey: image?.key }),
    onSuccess: async (fresh) => {
      setBody('');
      setImage(null);
      await onSent(fresh);
    },
  });

  // The words stay in the box, so a student whose query closed meanwhile can carry them over.
  const refusedClosed = AppException.is(send.error) && send.error.code === ErrorCodes.TICKET_CLOSED;
  const failure = send.isError && !refusedClosed ? bannerMessage(send.error) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 border-t border-border pt-4">
      {refusedClosed ? <ClosedAlert /> : null}
      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      {image ? (
        <div className="relative self-start">
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
            onClick={() => setImage(null)}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a reply"
          aria-label="Reply"
          rows={2}
          className="min-h-0 flex-1 resize-none"
        />

        <label className="relative shrink-0">
          <span className="sr-only">Add a picture</span>
          <input
            type="file"
            className="peer sr-only"
            accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
            disabled={upload.isPending || image !== null || refusedClosed}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
          />
          <span
            className={cn(
              'inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted',
              'peer-focus-visible:shadow-focus',
              'peer-disabled:pointer-events-none peer-disabled:border-disabled-border peer-disabled:bg-disabled peer-disabled:text-disabled-foreground',
            )}
          >
            <ImagePlus className="size-4" aria-hidden />
          </span>
        </label>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              loading={send.isPending}
              disabled={body.trim() === '' || upload.isPending || refusedClosed}
              onClick={() => send.mutate()}
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
