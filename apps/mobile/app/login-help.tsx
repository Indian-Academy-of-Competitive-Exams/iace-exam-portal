/// <reference types="nativewind/types" />
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Send from 'lucide-react-native/icons/send';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  EARLIEST_BIRTH_DATE,
  LOGIN_PROBLEMS,
  LOGIN_PROBLEM_LABELS,
  SUPPORT_FALLBACK_EMAIL,
  loginHelpSchema,
  todayISO,
  typedMobile,
  type LoginHelpInput,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { api } from '../src/lib/api';
import { LOGIN_HELP_BRANCHES_QUERY_KEY } from '../src/lib/constants';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { DateField } from '../src/components/ui/date-field';
import { FormPicker } from '../src/components/ui/form-picker';
import { TextField } from '../src/components/ui/text-field';

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

const OPTIONAL = 'Optional';

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
export default function LoginHelpScreen() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-4 px-5 py-6" keyboardShouldPersistTaps="handled">
        {sentTo === null ? (
          <HelpForm onSent={setSentTo} />
        ) : (
          <Alert variant="success">Query received. We will reply to {sentTo}.</Alert>
        )}

        {/* ui-copy-ok: rule */}
        <Alert>
          Still can&rsquo;t sign in? Mail {SUPPORT_FALLBACK_EMAIL} with your registered mobile.
        </Alert>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function HelpForm({ onSent }: Readonly<{ onSent: (email: string) => void }>) {
  const form = useForm<LoginHelpInput>({ resolver, defaultValues: BLANK });

  const branches = useQuery({
    queryKey: LOGIN_HELP_BRANCHES_QUERY_KEY,
    queryFn: () => api.auth.loginHelp.branches(),
  });
  const branchItems = (branches.data ?? []).map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  const submit = useMutation({
    // Silent: the form's own alert and fields say what went wrong, so a native alert would say it twice.
    meta: { silent: true },
    mutationFn: (values: LoginHelpInput) => api.auth.loginHelp.submit(values),
    onSuccess: (_received, values) => onSent(values.contactEmail),
    onError: (error) => applyFieldErrors<LoginHelpInput>(error, form.setError, [...FIELDS]),
  });
  const failure = submit.isError ? bannerMessage(submit.error, FIELDS) : null;

  return (
    <Card className="gap-4 p-5">
      <TextField control={form.control} name="fullName" label="Full name" autoComplete="name" />
      <TextField control={form.control} name="fatherName" label="Father's name" />
      <TextField
        control={form.control}
        name="registeredMobile"
        label="Registered mobile"
        keyboardType="number-pad"
        sanitize={typedMobile}
        prefix="+91"
      />
      <DateField
        control={form.control}
        name="dob"
        label="Date of birth"
        minimum={EARLIEST_BIRTH_DATE}
        maximum={todayISO()}
      />
      <FormPicker
        control={form.control}
        name="branchId"
        label="Branch"
        placeholder={branches.isPending ? 'Loading branches' : 'Choose a branch'}
        items={branchItems}
      />
      {/* ui-copy-ok: rule */}
      <TextField control={form.control} name="enrolmentId" label="Enrolment ID" hint={OPTIONAL} />
      <TextField
        control={form.control}
        name="contactEmail"
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextField
        control={form.control}
        name="contactMobile"
        label="Contact mobile"
        // ui-copy-ok: rule
        hint={OPTIONAL}
        keyboardType="number-pad"
        sanitize={typedMobile}
        prefix="+91"
      />
      <FormPicker
        control={form.control}
        name="problem"
        label="Problem"
        placeholder="Choose what went wrong"
        items={PROBLEM_ITEMS}
      />
      <TextField
        control={form.control}
        name="body"
        label="Message"
        multiline
        className="h-24 py-2"
      />

      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      <Button
        icon={Send}
        loading={submit.isPending}
        onPress={form.handleSubmit((values) => submit.mutate(values))}
      >
        Send
      </Button>
    </Card>
  );
}
