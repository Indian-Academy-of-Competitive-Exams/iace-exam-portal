import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  EXAM_COURSES,
  announcementChannelSchema,
  examCourseSchema,
  type AnnouncementChannel,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  Checkbox,
  FormDialog,
  FormField,
  Input,
  MultiCombobox,
  Skeleton,
  Textarea,
  plural,
} from '@iace/ui';
import { api } from '../../lib/api';
import { CHANNEL_LABEL, rupees } from './money';

const CHANNELS: readonly AnnouncementChannel[] = ['WHATSAPP', 'SMS'];

const COURSE_ITEMS = EXAM_COURSES.map((course) => ({
  value: course,
  label: course.replaceAll('_', '/'),
}));

/** The two cohort dimensions this dialog offers; the server validates the whole filter for real. */
const composeSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(ANNOUNCEMENT_TITLE_MAX),
  body: z.string().trim().min(1, 'Required').max(ANNOUNCEMENT_BODY_MAX),
  audience: z.object({
    branchId: z.array(z.string()),
    course: z.array(examCourseSchema),
  }),
  paidChannels: z.array(announcementChannelSchema),
});

type ComposeForm = z.infer<typeof composeSchema>;

/** The fields a server-side rejection can name. Anything else lands on the form as a whole. */
const COMPOSE_FIELDS = ['title', 'body'] as const;

const BLANK: ComposeForm = {
  title: '',
  body: '',
  audience: { branchId: [], course: [] },
  paidChannels: [],
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

export function ComposeAnnouncementDialog({ open, onOpenChange, onSent }: Readonly<Props>) {
  const form = useForm<ComposeForm>({
    resolver: zodResolver(composeSchema),
    defaultValues: BLANK,
  });

  const branches = useQuery({
    queryKey: ['admin', 'branches', 'all'],
    queryFn: () => api.admin.branches.list({ page: 1, pageSize: 100 }),
    enabled: open,
  });

  const branchId = useWatch({ control: form.control, name: 'audience.branchId' }) ?? [];
  const course = useWatch({ control: form.control, name: 'audience.course' }) ?? [];
  const paidChannels = useWatch({ control: form.control, name: 'paidChannels' }) ?? [];

  // Not memoised: a query key is hashed structurally, so a fresh object each render costs nothing.
  const audience = { branchId, course };

  const preview = useQuery({
    queryKey: ['admin', 'announcements', 'preview', audience, paidChannels],
    queryFn: () =>
      api.admin.announcements.preview({ title: 'x', body: 'x', audience, paidChannels }),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: (values: ComposeForm) => api.admin.announcements.send(values),
    onSuccess: () => {
      form.reset(BLANK);
      onSent();
    },
    onError: (error) => applyFieldErrors(error, form.setError, COMPOSE_FIELDS),
  });

  const branchItems = (branches.data?.items ?? []).map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => send.mutate(values)}
      title="New announcement"
      submitLabel="Send"
      loading={send.isPending}
    >
      <FormField form={form} name="title" label="Title">
        {(control) => (
          <Input {...control} maxLength={ANNOUNCEMENT_TITLE_MAX} autoFocus placeholder="" />
        )}
      </FormField>

      <FormField form={form} name="body" label="Message">
        {(control) => <Textarea {...control} maxLength={ANNOUNCEMENT_BODY_MAX} rows={4} />}
      </FormField>

      <FormField form={form} name="audience.branchId" label="Branches">
        {() => (
          <MultiCombobox
            items={branchItems}
            value={branchId}
            onChange={(next) => form.setValue('audience.branchId', next, { shouldDirty: true })}
            placeholder="Any branch"
          />
        )}
      </FormField>

      <FormField form={form} name="audience.course" label="Exam courses">
        {() => (
          <MultiCombobox
            items={COURSE_ITEMS}
            value={course}
            onChange={(next) =>
              form.setValue('audience.course', next as ComposeForm['audience']['course'], {
                shouldDirty: true,
              })
            }
            placeholder="Any course"
          />
        )}
      </FormField>

      <PaidChannels
        chosen={paidChannels}
        onChange={(next) => form.setValue('paidChannels', next, { shouldDirty: true })}
      />

      <Reach preview={preview.data} loading={preview.isLoading} />
    </FormDialog>
  );
}

/** Ordered: the first is what everyone gets, the second only what a failure falls back to. */
function PaidChannels({
  chosen,
  onChange,
}: Readonly<{ chosen: AnnouncementChannel[]; onChange: (next: AnnouncementChannel[]) => void }>) {
  const toggle = (channel: AnnouncementChannel) =>
    onChange(
      chosen.includes(channel)
        ? chosen.filter((held) => held !== channel)
        : CHANNELS.filter((held) => held === channel || chosen.includes(held)),
    );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Also send by</span>
      <div className="flex gap-6">
        {CHANNELS.map((channel) => (
          <Checkbox
            key={channel}
            label={CHANNEL_LABEL[channel]}
            checked={chosen.includes(channel)}
            onChange={() => toggle(channel)}
          />
        ))}
      </div>
    </div>
  );
}

/** The consequence that is invisible until too late: how many, and what it costs. */
function Reach({ preview, loading }: Readonly<{ preview?: Preview; loading: boolean }>) {
  if (loading || !preview) return <Skeleton variant="row" className="h-12" />;

  if (preview.overCap) {
    /* ui-copy-ok: consequence */
    return <Alert variant="danger">{overCap(preview)}</Alert>;
  }

  /* ui-copy-ok: consequence */
  return (
    <Alert variant={preview.estimatedCostPaise > 0 ? 'warning' : 'info'}>{reach(preview)}</Alert>
  );
}

interface Preview {
  recipientCount: number;
  reachableCount: number;
  estimatedCostPaise: number;
  overCap: boolean;
  cap: number;
}

function overCap(preview: Preview): string {
  const reaches = preview.recipientCount.toLocaleString('en-IN');
  const cap = preview.cap.toLocaleString('en-IN');

  return `That reaches ${reaches} students, over the ${cap} a single send allows.`;
}

function reach(preview: Preview): string {
  if (preview.estimatedCostPaise === 0) {
    return `${plural(preview.recipientCount, 'student')}, in the app only.`;
  }

  const spend = `${plural(preview.reachableCount, 'student')}, about ${rupees(preview.estimatedCostPaise)}`;
  const unreachable = preview.recipientCount - preview.reachableCount;
  if (unreachable === 0) return `${spend}.`;

  return `${spend} — ${unreachable} more have no mobile number on file.`;
}
