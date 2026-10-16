/// <reference types="nativewind/types" />
import { useEffect, useMemo } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Send from 'lucide-react-native/icons/send';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
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
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage, newestFirst } from '@iace/app-kit';
import { api } from '../../src/lib/api';
import { HELP_PARAMS, SUPPORT_QUERY_KEY, supportTicketQueryKey } from '../../src/lib/constants';
import { ACCOUNT_ROUTES, DETAIL_ROUTES } from '../../src/lib/nav';
import { performanceQuery } from '../../src/lib/queries';
import { Alert } from '../../src/components/ui/alert';
import { Button } from '../../src/components/ui/button';
import { FormPicker } from '../../src/components/ui/form-picker';
import { TextField } from '../../src/components/ui/text-field';

const FIELDS = ['title', 'category', 'attemptId', 'body'] as const;
const UNTITLED = 'Untitled test';

const CATEGORY_ITEMS = Object.values(SUPPORT_CATEGORIES).map((category) => ({
  value: category,
  label: SUPPORT_CATEGORY_INFO[category].label,
}));

/** Listed with the open ones first, so a page the size of the cap holds every one that counts. */
const OPEN_QUERY_KEY = [...SUPPORT_QUERY_KEY, 'open'] as const;

/** Text only: a picture goes on a later reply, once the query exists to hold it. */
export default function NewQueryScreen() {
  const params = useLocalSearchParams<{ category?: string; attemptId?: string }>();
  const router = useRouter();
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
      category: supportCategorySchema.safeParse(params[HELP_PARAMS.CATEGORY]).data,
      attemptId: params[HELP_PARAMS.ATTEMPT] || undefined,
      title: '',
      body: '',
    },
  });
  const category = useWatch({ control: form.control, name: 'category' });
  const info = category ? SUPPORT_CATEGORY_INFO[category] : null;

  const create = useMutation({
    // Silent: the form's own alert and fields say what went wrong, so a native alert would say it twice.
    meta: { silent: true },
    mutationFn: (values: CreateTicketInput) => api.me.support.create(values),
    onSuccess: async (ticket) => {
      queryClient.setQueryData(supportTicketQueryKey(ticket.id), ticket);
      await queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY });
      router.replace(DETAIL_ROUTES.HELP_QUERY(ticket.id));
    },
    onError: (error) => applyFieldErrors<CreateTicketInput>(error, form.setError, [...FIELDS]),
  });

  const refusedForLimit =
    AppException.is(create.error) && create.error.code === ErrorCodes.TICKET_LIMIT;
  const atLimit = openCount >= SUPPORT_MAX_OPEN || refusedForLimit;
  const failure = create.isError && !refusedForLimit ? bannerMessage(create.error, FIELDS) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-4 px-5 py-6" keyboardShouldPersistTaps="handled">
        {atLimit ? (
          <Alert
            variant="warning"
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => router.navigate(ACCOUNT_ROUTES.HELP)}
              >
                Open Help
              </Button>
            }
          >
            You have {SUPPORT_MAX_OPEN} open queries. Close one in Help to raise another.
          </Alert>
        ) : null}

        {/* ui-copy-ok: rule */}
        <TextField control={form.control} name="title" label="Title" hint="Optional" />

        <FormPicker
          control={form.control}
          name="category"
          label="Category"
          placeholder="Choose a category"
          items={CATEGORY_ITEMS}
          onPicked={() => form.setValue('attemptId', undefined)}
        />

        {/* ui-copy-ok: rule */}
        {info ? <Alert>{info.cannedAnswer}</Alert> : null}

        {info?.needsSitting ? <SittingField form={form} /> : null}

        <TextField
          control={form.control}
          name="body"
          label="Message"
          multiline
          className="h-28 py-2"
        />

        {failure ? <Alert variant="danger">{failure}</Alert> : null}

        <Button
          icon={Send}
          loading={create.isPending}
          disabled={atLimit}
          onPress={form.handleSubmit((values) => create.mutate(values))}
        >
          Send
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Their own marked sittings, newest first; the test is what a result query is about. */
function SittingField({ form }: Readonly<{ form: UseFormReturn<CreateTicketInput> }>) {
  const trend = useQuery(performanceQuery);
  const items = useMemo(
    () =>
      newestFirst(trend.data?.sittings ?? []).map((sitting) => {
        const title = sitting.testTitle ?? UNTITLED;
        const day = sitting.submittedAt ? instituteDayLabel(sitting.submittedAt) : null;
        return { value: sitting.attemptId, label: day ? `${title} · ${day}` : title };
      }),
    [trend.data],
  );

  // A sitting handed in by the link but not among theirs would show as nothing chosen while still sent.
  const held = useWatch({ control: form.control, name: 'attemptId' });
  const loaded = trend.data !== undefined;
  const { setValue } = form;
  useEffect(() => {
    if (loaded && held && !items.some((item) => item.value === held)) {
      setValue('attemptId', undefined);
    }
  }, [loaded, held, items, setValue]);

  return (
    <FormPicker
      control={form.control}
      name="attemptId"
      label="Test"
      placeholder={trend.isPending ? 'Loading your tests' : 'Choose a test'}
      items={items}
    />
  );
}
