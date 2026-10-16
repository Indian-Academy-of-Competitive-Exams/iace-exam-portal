import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
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
import { PageCrumbs } from '@iace/app-kit/browser';
import { Alert, Button, FormCombobox, FormField, PageFrame, PageHeader, Textarea } from '@iace/ui';
import { SurfaceCard } from '../../components/ui';
import { api } from '../../lib/api';
import {
  HELP_PARAMS,
  NAV_ITEMS,
  ROUTES,
  SUPPORT_QUERY_KEY,
  supportTicketQueryKey,
} from '../../lib/constants';
import { performanceQuery } from '../../lib/queries';

const FIELDS = ['category', 'attemptId', 'body'] as const;
const UNTITLED = 'Untitled test';

const CATEGORY_ITEMS = Object.values(SUPPORT_CATEGORIES).map((category) => ({
  value: category,
  label: SUPPORT_CATEGORY_INFO[category].label,
}));

/** Listed with the open ones first, so a page the size of the cap holds every one that counts. */
const OPEN_QUERY_KEY = [...SUPPORT_QUERY_KEY, 'open'] as const;

export function NewQueryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const open = useQuery({
    queryKey: OPEN_QUERY_KEY,
    queryFn: () => api.me.support.list({ page: 1, pageSize: SUPPORT_MAX_OPEN }),
  });
  const openCount =
    open.data?.items.filter((ticket) => ticket.status !== SUPPORT_STATUSES.CLOSED).length ?? 0;

  const form = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      category: supportCategorySchema.safeParse(params.get(HELP_PARAMS.CATEGORY)).data,
      attemptId: params.get(HELP_PARAMS.ATTEMPT) ?? undefined,
      body: '',
    },
  });
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
      void navigate(ROUTES.HELP_QUERY(ticket.id), { replace: true });
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...FIELDS]),
  });

  const refusedForLimit =
    AppException.is(create.error) && create.error.code === ErrorCodes.TICKET_LIMIT;
  const atLimit = openCount >= SUPPORT_MAX_OPEN || refusedForLimit;
  const failure = create.isError && !refusedForLimit ? bannerMessage(create.error, FIELDS) : null;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'New query' }]} />}
          title="New query"
        />
      }
    >
      <SurfaceCard className="mx-auto w-full max-w-2xl">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          {atLimit ? (
            <Alert variant="warning">
              <span>
                You have {SUPPORT_MAX_OPEN} open queries. Close one in{' '}
                <Link to={ROUTES.HELP} className="font-medium underline">
                  Help
                </Link>{' '}
                to raise another.
              </span>
            </Alert>
          ) : null}

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

          <Button
            type="submit"
            className="self-end"
            icon={<Send aria-hidden />}
            loading={create.isPending}
            disabled={atLimit}
          >
            Send
          </Button>
        </form>
      </SurfaceCard>
    </PageFrame>
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
