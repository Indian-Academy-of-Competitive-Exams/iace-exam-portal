import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, Lock, UserCheck, UserCog, X } from 'lucide-react';
import {
  CLAIM_FIELDS,
  FEATURE_KEYS,
  LOGIN_PROBLEM_LABELS,
  PERMISSION_LEVELS,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  instituteDateTimeLabel,
  type AdminTicketDetail,
  type AdminTicketPatch,
  type ClaimField,
} from '@iace/contracts';
import { PageCrumbs, shrunkForUpload } from '@iace/app-kit/browser';
import {
  Alert,
  BLANK_THREAD_DRAFT,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  EMPTY_STATE_KINDS,
  EmptyState,
  FormDialog,
  FormField,
  FormSection,
  PageHeader,
  RowActions,
  SegmentedControl,
  SkeletonParagraph,
  SplitFrame,
  StatRow,
  ThreadComposer,
  ThreadMessage,
  withThreadImage,
  type ThreadDraft,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS } from '../../lib/nav';
import { QUERY_KEYS, supportTicketQueryKey } from '../../lib/query-keys';
import { SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS } from '../../lib/labels';
import { useAuth } from '../../providers/auth';
import { AdminPicker } from '../../components/admin-multi-picker';
import { saidAt } from '../../lib/said-at';

const DASH = '—';

/** A reply reaches the student; a note stays among the admins. */
const MODES = { REPLY: 'reply', NOTE: 'note' } as const;
type Mode = (typeof MODES)[keyof typeof MODES];

const MODE_ITEMS = [
  { value: MODES.REPLY, label: 'Reply' },
  { value: MODES.NOTE, label: 'Internal note' },
];

/** The signed-out form's fields, as the claim names them. */
const CLAIM_LABELS: Readonly<Record<ClaimField, string>> = {
  [CLAIM_FIELDS.FULL_NAME]: 'Name',
  [CLAIM_FIELDS.REGISTERED_MOBILE]: 'Registered mobile',
  [CLAIM_FIELDS.DOB]: 'DOB',
  [CLAIM_FIELDS.FATHER_NAME]: "Father's name",
  [CLAIM_FIELDS.BRANCH]: 'Branch',
  [CLAIM_FIELDS.ENROLMENT_ID]: 'Enrolment ID',
};

/** One image a message: the server takes a single attachment key. */
const MAX_IMAGES = 1;

/** One student query: the thread beside who asked and what about. */
export function SupportTicketPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = can(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE);

  const [closing, setClosing] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  const detail = useQuery({
    queryKey: supportTicketQueryKey(id),
    queryFn: () => api.admin.support.detail(id),
  });
  const ticket = detail.data;

  // The queue, the badge and this record all sit under one root, so one call refreshes each.
  const settle = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUPPORT });

  const patch = useMutation({
    mutationFn: (input: AdminTicketPatch) => api.admin.support.patch(id, input),
    onSuccess: settle,
  });
  const close = useMutation({
    mutationFn: () => api.admin.support.close(id),
    onSuccess: async () => {
      setClosing(false);
      await settle();
    },
  });
  const resend = useMutation({
    mutationFn: (messageId: string) => api.admin.support.resend(id, messageId),
    onSuccess: settle,
  });

  const foot = useRef<HTMLDivElement>(null);
  const messageCount = ticket?.messages.length ?? 0;
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  const label = ticket ? SUPPORT_CATEGORY_INFO[ticket.category].label : 'Query';
  const closed = ticket?.status === SUPPORT_STATUSES.CLOSED;
  const asker = ticket?.student?.fullName ?? ticket?.claimedName ?? 'Student';

  return (
    <SplitFrame
      fills
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label }]} />}
          title={label}
          meta={ticket ? SUPPORT_STATUS_LABELS[ticket.status] : undefined}
          action={
            ticket && canWrite && !closed ? (
              <TicketActions
                ticket={ticket}
                onPatch={(input) => patch.mutate(input)}
                onReassign={() => setReassigning(true)}
                onClose={() => setClosing(true)}
              />
            ) : undefined
          }
        />
      }
      side={ticket ? <TicketFacts ticket={ticket} /> : null}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        {/* mt-auto, never justify-end: a justified flex scroller clips its overflow out of reach. */}
        <div className="mt-auto flex flex-col gap-4">
          {detail.isLoading ? <SkeletonParagraph lines={6} /> : null}

          {detail.isError && !ticket ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              size="sm"
              level={3}
              title="Could not load this query"
              onRetry={detail.refetch}
            />
          ) : null}

          {ticket?.messages.map((message) => (
            <ThreadMessage
              key={message.id}
              authorName={message.fromStaff ? message.authorName : asker}
              label={message.internal ? 'Note' : undefined}
              at={saidAt(message.createdAt)}
              body={message.body}
              images={message.attachmentUrl ? [message.attachmentUrl] : []}
              mine={message.fromStaff}
              tone={message.internal ? 'warning' : undefined}
            >
              {message.emailFailedAt ? (
                <EmailNotSent
                  sending={resend.isPending && resend.variables === message.id}
                  onResend={canWrite ? () => resend.mutate(message.id) : undefined}
                />
              ) : null}
            </ThreadMessage>
          ))}

          <div ref={foot} />
        </div>
      </div>

      {ticket && canWrite && !closed ? (
        <ReplyBox
          ticketId={id}
          closesOnReply={ticket.linked ? null : ticket.contactEmail}
          onSent={settle}
        />
      ) : null}

      {closing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setClosing(false)}
          destructive
          title={`Close ${asker}’s query?`}
          description="The student can no longer reply."
          confirmLabel="Close query"
          loading={close.isPending}
          onConfirm={() => close.mutate()}
        />
      ) : null}

      {reassigning && ticket ? (
        <ReassignDialog
          key={ticket.id}
          current={ticket.assigneeId}
          saving={patch.isPending}
          onClose={() => setReassigning(false)}
          onSave={(assigneeId) =>
            patch.mutate({ assigneeId }, { onSuccess: () => setReassigning(false) })
          }
        />
      ) : null}
    </SplitFrame>
  );
}

function ReplyBox({
  ticketId,
  closesOnReply,
  onSent,
}: Readonly<{
  ticketId: string;
  /** An unlinked ticket's contact address: a reply is mailed there and closes it. */
  closesOnReply: string | null;
  onSent: () => Promise<void>;
}>) {
  const { identity } = useAuth();
  const [composing, setComposing] = useState<ThreadDraft>(BLANK_THREAD_DRAFT);
  const [mode, setMode] = useState<Mode>(MODES.REPLY);

  // A mutation, so a picture the server refuses is announced like any other failed write.
  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.admin.support.upload(ticketId, await shrunkForUpload(file)),
    onSuccess: (image) => setComposing(withThreadImage(image)),
  });

  const say = useMutation({
    mutationFn: () =>
      api.admin.support.reply(ticketId, {
        body: composing.body,
        attachmentKey: composing.images[0]?.key,
        internal: mode === MODES.NOTE,
      }),
    onSuccess: async () => {
      setComposing(BLANK_THREAD_DRAFT);
      await onSent();
    },
  });

  return (
    <ThreadComposer
      composing={composing}
      sending={say.isPending}
      name={identity?.fullName ?? null}
      onChange={setComposing}
      onSend={() => say.mutate()}
      onPickImage={(file) => upload.mutate(file)}
      uploading={upload.isPending}
      accept={QUESTION_IMAGE_ACCEPTED_TYPES.join(',')}
      maxImages={MAX_IMAGES}
      placeholder={mode === MODES.NOTE ? 'Write a note' : 'Write a reply'}
      requireText
      head={
        <>
          <SegmentedControl
            aria-label="Send as"
            value={mode}
            onChange={(next) => setMode(next as Mode)}
            items={MODE_ITEMS}
            className="self-start"
          />
          {closesOnReply !== null && mode === MODES.REPLY ? (
            <Alert variant="warning">
              A reply is emailed to {closesOnReply} and closes this query
            </Alert>
          ) : null}
        </>
      }
    />
  );
}

function TicketActions({
  ticket,
  onPatch,
  onReassign,
  onClose,
}: Readonly<{
  ticket: AdminTicketDetail;
  onPatch: (input: AdminTicketPatch) => void;
  onReassign: () => void;
  onClose: () => void;
}>) {
  const { identity } = useAuth();
  const high = ticket.priority === SUPPORT_PRIORITIES.HIGH;

  return (
    <RowActions label="Query actions">
      {identity && ticket.assigneeId !== identity.id ? (
        <DropdownMenuItem onSelect={() => onPatch({ assigneeId: identity.id })}>
          <UserCheck aria-hidden />
          Claim
        </DropdownMenuItem>
      ) : null}
      {/* Listing admins is a super admin's read, so only they are offered the picker. */}
      {identity?.isSuperAdmin ? (
        <DropdownMenuItem onSelect={onReassign}>
          <UserCog aria-hidden />
          Reassign
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        onSelect={() =>
          onPatch({ priority: high ? SUPPORT_PRIORITIES.NORMAL : SUPPORT_PRIORITIES.HIGH })
        }
      >
        <Flag aria-hidden />
        {high ? 'Set priority to Normal' : 'Set priority to High'}
      </DropdownMenuItem>
      <DropdownMenuItem destructive onSelect={onClose}>
        <Lock aria-hidden />
        Close
      </DropdownMenuItem>
    </RowActions>
  );
}

/** The fallback email to a student bounced; the resend sits inside the alert that names it. */
function EmailNotSent({
  sending,
  onResend,
}: Readonly<{ sending: boolean; onResend: (() => void) | undefined }>) {
  return (
    <Alert variant="danger">
      <span className="flex flex-1 items-center justify-between gap-3">
        Email not sent
        {onResend ? (
          <Button size="sm" variant="outline" loading={sending} onClick={onResend}>
            Resend
          </Button>
        ) : null}
      </span>
    </Alert>
  );
}

function ReassignDialog({
  current,
  saving,
  onClose,
  onSave,
}: Readonly<{
  current: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (assigneeId: string) => void;
}>) {
  const form = useForm<{ assigneeId: string }>({ defaultValues: { assigneeId: current ?? '' } });
  const chosen = useWatch({ control: form.control, name: 'assigneeId' });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => onSave(values.assigneeId)}
      title="Reassign query"
      submitLabel="Reassign"
      loading={saving}
      submitDisabled={!chosen || chosen === current}
    >
      <FormField form={form} name="assigneeId" label="Admin">
        {(control) => (
          <AdminPicker
            id={control.id}
            value={chosen}
            placeholder="Choose an admin"
            clearable={false}
            onChange={(value) => form.setValue('assigneeId', value, { shouldDirty: true })}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function TicketFacts({ ticket }: Readonly<{ ticket: AdminTicketDetail }>) {
  const { claim } = ticket;
  return (
    <>
      <FormSection title="Query">
        <Facts
          rows={[
            ['Status', SUPPORT_STATUS_LABELS[ticket.status]],
            ['Priority', SUPPORT_PRIORITY_LABELS[ticket.priority]],
            ['Assignee', ticket.assigneeName ?? 'Unclaimed'],
            ['Opened', instituteDateTimeLabel(ticket.createdAt)],
          ]}
        />
      </FormSection>

      {ticket.student ? (
        <FormSection title="Student">
          <Facts
            rows={[
              ['Name', ticket.student.fullName ?? DASH],
              ['Mobile', ticket.student.mobile],
              ['Branch', ticket.student.branchName ?? DASH],
              ['Exams', ticket.student.enrolledExams.join(', ') || DASH],
              ['Contact email', ticket.contactEmail ?? DASH],
            ]}
          />
        </FormSection>
      ) : null}

      {claim ? (
        <FormSection title="Claim">
          <div className="flex flex-col gap-2">
            <StatRow label="Problem" value={LOGIN_PROBLEM_LABELS[claim.problem]} />
            {Object.values(CLAIM_FIELDS).map((field) => {
              const { claimed, matches } = claim.checks[field];
              return (
                <StatRow
                  key={field}
                  className="items-start"
                  label={CLAIM_LABELS[field]}
                  value={
                    <span className="flex items-center justify-end gap-1.5 text-right [&_svg]:size-4 [&_svg]:shrink-0">
                      {claimed ?? DASH}
                      <MatchMark matches={matches} />
                    </span>
                  }
                />
              );
            })}
            <StatRow label="Contact mobile" value={claim.contactMobile ?? DASH} />
            {ticket.student ? null : (
              <StatRow label="Contact email" value={ticket.contactEmail ?? DASH} />
            )}
          </div>
        </FormSection>
      ) : null}

      {ticket.attempt ? (
        <FormSection title="Sitting">
          <Facts
            rows={[
              ['Test', ticket.attempt.testName],
              [
                'Submitted',
                ticket.attempt.submittedAt
                  ? instituteDateTimeLabel(ticket.attempt.submittedAt)
                  : DASH,
              ],
            ]}
          />
        </FormSection>
      ) : null}
    </>
  );
}

function Facts({ rows }: Readonly<{ rows: readonly (readonly [string, string])[] }>) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([label, value]) => (
        <StatRow
          key={label}
          className="items-start"
          label={label}
          value={<span className="block text-right">{value}</span>}
        />
      ))}
    </div>
  );
}

/** Whether a claimed field agrees with the linked record; nothing when there was nothing to compare. */
function MatchMark({ matches }: Readonly<{ matches: boolean | null }>) {
  if (matches === null) return null;
  return matches ? (
    <Check className="text-success" aria-label="Matches the record" />
  ) : (
    <X className="text-destructive" aria-label="Does not match the record" />
  );
}
