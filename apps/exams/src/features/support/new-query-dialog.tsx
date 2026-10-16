import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  ErrorCodes,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_MAX_OPEN,
  SUPPORT_STATUSES,
  createTicketSchema,
  instituteDayLabel,
  supportCategorySchema,
  type CreateTicketInput,
  type SupportCategory,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage, newestFirst } from '@iace/app-kit';
import { Alert, FormCombobox, FormDialog, FormField, Input, Textarea } from '@iace/ui';
import { api } from '../../lib/api';
import { HELP_PARAMS, ROUTES, SUPPORT_QUERY_KEY, supportTicketQueryKey } from '../../lib/constants';
import { performanceQuery } from '../../lib/queries';

const FIELDS = ['title', 'category', 'attemptId', 'body'] as const;
const UNTITLED = 'Untitled test';

const CATEGORY_ITEMS = Object.values(SUPPORT_CATEGORIES).map((category) => ({
  value: category,
  label: SUPPORT_CATEGORY_INFO[category].label,
}));

/** Listed with the open ones first, so a page the size of the cap holds every one that counts. */
const OPEN_QUERY_KEY = [...SUPPORT_QUERY_KEY, 'open'] as const;

/** A new query, its category and sitting prefilled from the address when a report sent them here. */
export function NewQueryDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const openOnes = useQuery({
    queryKey: OPEN_QUERY_KEY,
    queryFn: () => api.me.support.list({ page: 1, pageSize: SUPPORT_MAX_OPEN }),
    enabled: open,
  });
  const openCount =
    openOnes.data?.items.filter((ticket) => ticket.status !== SUPPORT_STATUSES.CLOSED).length ?? 0;

  const form = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { title: '', body: '' },
  });

  // The prefill arrives with the address, so it is set each time the dialog opens, not once at mount.
  const prefillCategory = params.get(HELP_PARAMS.RAISE);
  const prefillAttempt = params.get(HELP_PARAMS.ATTEMPT);
  useEffect(() => {
    if (!open) return;
    form.reset({
      title: '',
      body: '',
      category: supportCategorySchema.safeParse(prefillCategory).data,
      attemptId: prefillAttempt ?? undefined,
    });
  }, [open, prefillCategory, prefillAttempt, form]);

  const category = useWatch({ control: form.control, name: 'category' }) as
    SupportCategory | undefined;
  const info = category ? SUPPORT_CATEGORY_INFO[category] : null;

  const create = useMutation({
    // Silent: the form's own alert and fields say what went wrong, so a toast would say it twice.
    meta: { silent: true },
    mutationFn: (values: CreateTicketInput) => api.me.support.create(values),
    onSuccess: async (ticket) => {
      queryClient.setQueryData(supportTicketQueryKey(ticket.id), ticket);
      await queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY });
      void navigate(ROUTES.HELP_QUERY(ticket.id));
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...FIELDS]),
  });

  const refusedForLimit =
    AppException.is(create.error) && create.error.code === ErrorCodes.TICKET_LIMIT;
  const atLimit = openCount >= SUPPORT_MAX_OPEN || refusedForLimit;
  const failure = create.isError && !refusedForLimit ? bannerMessage(create.error, FIELDS) : null;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset();
        onOpenChange(next);
      }}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New query"
      submitLabel="Send"
      loading={create.isPending}
      submitDisabled={atLimit}
    >
      {atLimit ? (
        <Alert variant="warning">
          You have {SUPPORT_MAX_OPEN} open queries. Close one to raise another.
        </Alert>
      ) : null}

      {/* ui-copy-ok: rule */}
      <FormField form={form} name="title" label="Title" hint="Optional">
        {(control) => <Input {...control} />}
      </FormField>

      <FormCombobox
        form={form}
        name="category"
        label="Category"
        placeholder="Choose a category"
        items={CATEGORY_ITEMS}
        onChange={() => form.setValue('attemptId', undefined)}
      />

      {/* ui-copy-ok: rule */}
      {info ? <Alert variant="info">{info.cannedAnswer}</Alert> : null}

      {info?.needsSitting ? <SittingField form={form} /> : null}

      <FormField form={form} name="body" label="Message">
        {(control) => <Textarea rows={5} {...control} />}
      </FormField>

      {failure ? <Alert variant="danger">{failure}</Alert> : null}
    </FormDialog>
  );
}

/** Their own marked sittings, newest first; the test is what a result query is about. */
function SittingField({ form }: Readonly<{ form: ReturnType<typeof useForm<CreateTicketInput>> }>) {
  const trend = useQuery(performanceQuery);
  const items = useMemo(
    () =>
      newestFirst(trend.data?.sittings ?? []).map((sitting) => ({
        value: sitting.attemptId,
        label: sitting.testTitle ?? UNTITLED,
        hint: sitting.submittedAt ? instituteDayLabel(sitting.submittedAt) : undefined,
      })),
    [trend.data],
  );

  // A sitting handed in by the address but not among theirs would show as a bare id.
  const held = useWatch({ control: form.control, name: 'attemptId' });
  const loaded = trend.data !== undefined;
  useEffect(() => {
    if (loaded && held && !items.some((item) => item.value === held)) {
      form.setValue('attemptId', undefined);
    }
  }, [loaded, held, items, form]);

  return (
    <FormCombobox
      form={form}
      name="attemptId"
      label="Test"
      placeholder={trend.isPending ? 'Loading your tests' : 'Choose a test'}
      items={items}
    />
  );
}
