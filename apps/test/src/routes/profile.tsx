import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { GENDERS, todayISO, updateMeSchema, type UpdateMeInput } from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@iace/ui';
import { HistoryEditor } from '../components/history-editor';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { api } from '../lib/api';
import { ME_QUERY_KEY, PROFILE_QUERY_KEY, ROUTES } from '../lib/constants';

/**
 * Named once so the banner and the field mapping cannot drift apart.
 *
 * The nested paths are the names the FORM registers. The server keys its errors
 * the same way (`profile.dob`), and `applyFieldErrors` also matches on the leaf,
 * so either spelling lands on the right input.
 */
const FORM_FIELDS = [
  'fullName',
  'profile.motherName',
  'profile.fatherName',
  'profile.dob',
  'profile.email',
  'profile.address',
  'profile.gender',
] as const;

/**
 * The student's own details.
 *
 * The three pre-test fields sit at the top, in their own card, because they are
 * the ones that stop a hall ticket being issued. Everything below is optional
 * and says so — a form that treats a middle name with the same weight as a date
 * of birth teaches the reader that none of it matters.
 */
export function ProfilePage() {
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  const form = useForm<UpdateMeInput>({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { fullName: '', profile: { educationDetails: [], pastExamHistory: [] } },
  });

  // Filled once the record arrives. `reset` rather than defaultValues, because
  // the form mounts before the fetch resolves.
  const { reset } = form;
  useEffect(() => {
    if (!me.data) return;
    reset({
      fullName: me.data.fullName ?? '',
      profile: {
        motherName: me.data.profile?.motherName ?? '',
        fatherName: me.data.profile?.fatherName ?? '',
        dob: me.data.profile?.dob ?? '',
        email: me.data.profile?.email ?? '',
        address: me.data.profile?.address ?? '',
        gender: me.data.profile?.gender ?? undefined,
        educationDetails: me.data.profile?.educationDetails ?? [],
        pastExamHistory: me.data.profile?.pastExamHistory ?? [],
      },
    });
  }, [me.data, reset]);

  const save = useMutation({
    // The central handler announces the outcome — see createAppQueryClient.
    // `fields` is what keeps a validation failure OFF the toast and on the
    // input that caused it.
    meta: { success: 'Your details have been saved.', fields: FORM_FIELDS },
    mutationFn: (values: UpdateMeInput) => api.me.update(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      // The identity carries preTestReady, and saving these fields is exactly
      // what changes it — without this the prompt would still be there.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      form.reset(form.getValues());
    },
    onError: (error) => applyFieldErrors(error, form.setError, FORM_FIELDS),
  });

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to={ROUTES.PROFILE}>
          <ArrowLeft aria-hidden />
          Back to profile
        </Link>
      </Button>

      <PageHeader
        title="Your details"
        description="Only three of these are needed before a test. The rest you can fill in whenever you like."
      />

      {me.data ? <PreTestPrompt preTestReady={me.data.preTestReady} /> : null}

      {me.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </p>
      )}
      {me.error && <Alert variant="danger">Could not load your details.</Alert>}
      {!me.isPending && !me.error && (
        <form
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          noValidate
        >
          <Card>
            <CardHeader>
              <CardTitle>Needed before a test</CardTitle>
              <CardDescription>
                These three go on your hall ticket and answer sheet.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="motherName"
                label="Mother's name"
                error={form.formState.errors.profile?.motherName?.message}
              >
                {(control) => <Input {...control} {...form.register('profile.motherName')} />}
              </Field>

              <Field
                htmlFor="fatherName"
                label="Father's name"
                error={form.formState.errors.profile?.fatherName?.message}
              >
                {(control) => <Input {...control} {...form.register('profile.fatherName')} />}
              </Field>

              <Field
                htmlFor="dob"
                label="Date of birth"
                error={form.formState.errors.profile?.dob?.message}
              >
                {(control) => (
                  // Capped at today: a picker that offers next year is offering
                  // something the server will refuse.
                  <Input
                    type="date"
                    max={todayISO()}
                    {...control}
                    {...form.register('profile.dob')}
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About you</CardTitle>
              <CardDescription>All optional — nothing here blocks a test.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="fullName"
                label="Full name"
                error={form.formState.errors.fullName?.message}
              >
                {(control) => <Input {...control} {...form.register('fullName')} />}
              </Field>

              <Field
                htmlFor="email"
                label="Email"
                error={form.formState.errors.profile?.email?.message}
              >
                {(control) => (
                  <Input type="email" {...control} {...form.register('profile.email')} />
                )}
              </Field>

              <Field
                htmlFor="gender"
                label="Gender"
                error={form.formState.errors.profile?.gender?.message}
              >
                {(control) => (
                  <Select {...control} {...form.register('profile.gender')}>
                    <option value="">Prefer not to say</option>
                    {GENDERS.map((gender) => (
                      <option key={gender} value={gender}>
                        {gender.charAt(0) + gender.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div className="sm:col-span-2">
                <Field
                  htmlFor="address"
                  label="Address"
                  error={form.formState.errors.profile?.address?.message}
                >
                  {(control) => (
                    <Textarea rows={3} {...control} {...form.register('profile.address')} />
                  )}
                </Field>
              </div>
            </CardContent>
          </Card>

          <HistoryEditor
            control={form.control}
            name="profile.educationDetails"
            title="Education"
            description="Schooling and degrees so far. All optional."
            addLabel="Add a qualification"
            columns={[
              { key: 'level', label: 'Qualification', span: 3 },
              { key: 'board', label: 'Board / University', span: 3 },
              { key: 'institution', label: 'Institution', span: 3 },
              { key: 'year', label: 'Year', type: 'number', span: 1.4 },
              { key: 'percentage', label: '%', type: 'number', span: 1 },
            ]}
            emptyRow={{ level: '', board: '', institution: '', year: '', percentage: '' }}
          />

          <HistoryEditor
            control={form.control}
            name="profile.pastExamHistory"
            title="Exams sat elsewhere"
            description="Government exams you have attempted before. Nothing here affects your tests on IACE."
            addLabel="Add an exam"
            columns={[
              { key: 'exam', label: 'Exam', span: 3 },
              { key: 'year', label: 'Year', type: 'number', span: 1.4 },
              { key: 'result', label: 'Result', span: 3 },
            ]}
            emptyRow={{ exam: '', year: '', result: '' }}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save changes
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              disabled={!form.formState.isDirty}
              onClick={() => form.reset()}
            >
              Discard
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
