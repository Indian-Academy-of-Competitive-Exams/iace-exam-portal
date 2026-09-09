import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  EXAM_COURSES,
  examCourseSchema,
  type AnnouncementAudience,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  FormDialog,
  FormField,
  Input,
  MultiCombobox,
  Skeleton,
  Textarea,
  plural,
} from '@iace/ui';
import { api } from '../../lib/api';

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
});

type ComposeForm = z.infer<typeof composeSchema>;

/** The fields a server-side rejection can name. Anything else lands on the form as a whole. */
const COMPOSE_FIELDS = ['title', 'body'] as const;

const BLANK: ComposeForm = {
  title: '',
  body: '',
  audience: { branchId: [], course: [] },
};

/** A notice worth sending twice: the words and the cohort, lifted off a row already sent. */
export interface AnnouncementDraft {
  title: string;
  body: string;
  audience: AnnouncementAudience;
}

/** The two dimensions this dialog offers; a saved audience may carry filters it cannot show. */
function draftForm(draft: AnnouncementDraft | null): ComposeForm {
  if (!draft) return BLANK;

  return {
    title: draft.title,
    body: draft.body,
    audience: {
      branchId: draft.audience.branchId ?? [],
      course: draft.audience.course ?? [],
    },
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
  /** A notice being sent again. The dialog is keyed by it, so opening one resets the form to it. */
  draft?: AnnouncementDraft | null;
}

export function ComposeAnnouncementDialog({
  open,
  onOpenChange,
  onSent,
  draft = null,
}: Readonly<Props>) {
  const form = useForm<ComposeForm>({
    resolver: zodResolver(composeSchema),
    defaultValues: draftForm(draft),
  });

  const branches = useQuery({
    queryKey: ['admin', 'branches', 'all'],
    queryFn: () => api.admin.branches.list({ page: 1, pageSize: 100 }),
    enabled: open,
  });

  const branchId = useWatch({ control: form.control, name: 'audience.branchId' }) ?? [];
  const course = useWatch({ control: form.control, name: 'audience.course' }) ?? [];

  // Not memoised: a query key is hashed structurally, so a fresh object each render costs nothing.
  const audience = { branchId, course };

  const preview = useQuery({
    queryKey: ['admin', 'announcements', 'preview', audience],
    queryFn: () =>
      api.admin.announcements.preview({ title: 'x', body: 'x', audience, paidChannels: [] }),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: (values: ComposeForm) => api.admin.announcements.send(values),
    onSuccess: () => {
      form.reset(draftForm(draft));
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
      title={draft ? 'Send again' : 'New announcement'}
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

      <Reach preview={preview.data} loading={preview.isLoading} />
    </FormDialog>
  );
}

/** The consequence that is invisible until too late: how many students this reaches. */
function Reach({ preview, loading }: Readonly<{ preview?: Preview; loading: boolean }>) {
  if (loading || !preview) return <Skeleton variant="row" className="h-12" />;

  /* ui-copy-ok: consequence */
  if (preview.overCap) return <Alert variant="danger">{overCap(preview)}</Alert>;

  /* ui-copy-ok: consequence */
  return <Alert variant="info">{plural(preview.recipientCount, 'student')}, in the app.</Alert>;
}

interface Preview {
  recipientCount: number;
  overCap: boolean;
  cap: number;
}

function overCap(preview: Preview): string {
  const reaches = preview.recipientCount.toLocaleString('en-IN');
  const cap = preview.cap.toLocaleString('en-IN');

  return `That reaches ${reaches} students, over the ${cap} a single send allows.`;
}
