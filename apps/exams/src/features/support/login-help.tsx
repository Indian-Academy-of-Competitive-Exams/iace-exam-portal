import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import {
  EARLIEST_BIRTH_DATE,
  LOGIN_PROBLEMS,
  LOGIN_PROBLEM_LABELS,
  SUPPORT_FALLBACK_EMAIL,
  loginHelpSchema,
  todayISO,
  type LoginHelpInput,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import {
  Alert,
  Brandmark,
  Button,
  Card,
  CardStep,
  DatePicker,
  Field,
  FormCombobox,
  FormField,
  Input,
  Textarea,
  ThemeToggle,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ROUTES } from '../../lib/constants';
import { MobileField } from '../auth/login';

const PROBLEM_ITEMS = Object.values(LOGIN_PROBLEMS).map((problem) => ({
  value: problem,
  label: LOGIN_PROBLEM_LABELS[problem],
}));

const FIELDS = [
  'fullName',
  'registeredMobile',
  'dob',
  'fatherName',
  'branchId',
  'enrolmentId',
  'contactMobile',
  'contactEmail',
  'problem',
  'body',
] as const;

const BRANCHES_QUERY_KEY = ['auth', 'login-help', 'branches'] as const;

const schemaResolver = zodResolver(loginHelpSchema);
/** A left-blank optional field is absent, never an empty string the schema would refuse. */
const resolver: Resolver<LoginHelpInput> = (values, context, options) =>
  schemaResolver(
    {
      ...values,
      enrolmentId: values.enrolmentId || undefined,
      contactMobile: values.contactMobile || undefined,
    },
    context,
    options,
  );

const BLANK: Partial<LoginHelpInput> = {
  fullName: '',
  registeredMobile: '',
  dob: '',
  fatherName: '',
  enrolmentId: '',
  contactMobile: '',
  contactEmail: '',
  body: '',
};

/** Signed out on purpose: the student it serves is the one who cannot sign in. */
export function LoginHelpPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-5 py-16">
        <Card className="w-full max-w-xl shadow-md">
          <Brandmark size="lg" className="justify-center px-6 pt-7" />

          <CardStep title="Sign-in help">
            <div className="flex flex-col gap-4">
              {sentTo === null ? (
                <HelpForm onSent={setSentTo} />
              ) : (
                <Alert variant="success">Query received. We will reply to {sentTo}.</Alert>
              )}

              {/* ui-copy-ok: rule */}
              <Alert variant="info">
                Still can&rsquo;t sign in? Mail {SUPPORT_FALLBACK_EMAIL} with your registered
                mobile.
              </Alert>

              <Button asChild variant="ghost" size="sm">
                <Link to={ROUTES.LOGIN}>
                  <ArrowLeft aria-hidden />
                  Back to sign in
                </Link>
              </Button>
            </div>
          </CardStep>
        </Card>
      </main>
    </div>
  );
}

function HelpForm({ onSent }: Readonly<{ onSent: (email: string) => void }>) {
  const form = useForm<LoginHelpInput>({ resolver, defaultValues: BLANK });
  const dob = useWatch({ control: form.control, name: 'dob' });

  const branches = useQuery({
    queryKey: BRANCHES_QUERY_KEY,
    queryFn: () => api.auth.loginHelp.branches(),
  });
  const branchItems = (branches.data ?? []).map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  const submit = useMutation({
    // Silent: the form's own alert and fields say what went wrong, so a toast would say it twice.
    meta: { silent: true },
    mutationFn: (values: LoginHelpInput) => api.auth.loginHelp.submit(values),
    onSuccess: (_received, values) => onSent(values.contactEmail),
    onError: (error) => applyFieldErrors(error, form.setError, [...FIELDS]),
  });
  const failure = submit.isError ? bannerMessage(submit.error, FIELDS) : null;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => submit.mutate(values))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField form={form} name="fullName" label="Full name">
          {(control) => <Input autoComplete="name" {...control} />}
        </FormField>
        <FormField form={form} name="fatherName" label="Father's name">
          {(control) => <Input {...control} />}
        </FormField>

        <MobileField form={form} name="registeredMobile" label="Registered mobile" />
        <Field htmlFor="dob" label="Date of birth" error={form.formState.errors.dob?.message}>
          {(control) => (
            <DatePicker
              {...control}
              min={EARLIEST_BIRTH_DATE}
              max={todayISO()}
              value={dob ?? ''}
              onChange={(next) => {
                form.clearErrors('dob');
                form.setValue('dob', next, { shouldDirty: true });
              }}
            />
          )}
        </Field>

        <FormCombobox
          form={form}
          name="branchId"
          label="Branch"
          placeholder={branches.isPending ? 'Loading branches' : 'Choose a branch'}
          items={branchItems}
        />
        {/* ui-copy-ok: rule */}
        <FormField form={form} name="enrolmentId" label="Enrolment ID" hint="Optional">
          {(control) => <Input {...control} />}
        </FormField>

        <FormField form={form} name="contactEmail" label="Email">
          {(control) => <Input type="email" autoComplete="email" {...control} />}
        </FormField>
        {/* ui-copy-ok: rule */}
        <MobileField form={form} name="contactMobile" label="Contact mobile" hint="Optional" />
      </div>

      <FormCombobox
        form={form}
        name="problem"
        label="Problem"
        placeholder="Choose what went wrong"
        items={PROBLEM_ITEMS}
      />

      <FormField form={form} name="body" label="Message">
        {(control) => <Textarea rows={4} {...control} />}
      </FormField>

      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      <Button type="submit" icon={<Send aria-hidden />} loading={submit.isPending}>
        Send
      </Button>
    </form>
  );
}
