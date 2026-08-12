import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { PAGE_SIZE_MAX, type Gender, type StudentDetail } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Select,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';

interface FormValues {
  fullName: string;
  motherName: string;
  fatherName: string;
  dob: string;
  email: string;
  address: string;
  gender: '' | Gender;
  groupIds: string[];
}

const FORM_FIELDS = [
  'fullName',
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
  'groupIds',
] as const;

/** An empty input means "no value", which the API expresses as null. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    motherName: student.profile?.motherName ?? '',
    fatherName: student.profile?.fatherName ?? '',
    dob: student.profile?.dob ?? '',
    email: student.profile?.email ?? '',
    address: student.profile?.address ?? '',
    gender: student.profile?.gender ?? '',
    groupIds: student.groups.map((group) => group.id),
  };
}

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const student = useQuery({
    queryKey: ['admin', 'student', id],
    queryFn: () => api.admin.students.detail(id),
  });

  // Every batch, so membership can be edited without a second search box. The
  // count is small by nature — batches are branches and timings, not students.
  const batches = useQuery({
    queryKey: ['admin', 'groups', 'all'],
    queryFn: () => api.admin.groups.list({ pageSize: PAGE_SIZE_MAX }),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      motherName: '',
      fatherName: '',
      dob: '',
      email: '',
      address: '',
      gender: '',
      groupIds: [],
    },
  });

  // The form is created before the student arrives, so seed it on load — and
  // only when the id changes, or an in-progress edit would be wiped by a
  // background refetch.
  useEffect(() => {
    if (student.data) form.reset(toFormValues(student.data));
  }, [student.data?.id]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.admin.students.update(id, {
        fullName: orNull(values.fullName),
        // Only send membership when it actually changed: an omitted key means
        // "leave it alone", which is the truthful thing to say about a set of
        // checkboxes nobody touched.
        ...(form.formState.dirtyFields.groupIds ? { groupIds: values.groupIds } : {}),
        profile: {
          motherName: orNull(values.motherName),
          fatherName: orNull(values.fatherName),
          dob: orNull(values.dob),
          email: orNull(values.email),
          address: orNull(values.address),
          gender: values.gender === '' ? null : values.gender,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'student', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
      form.reset(toFormValues(updated));
      setSaved(true);
    },
    onError: (error) => applyFieldErrors(error, form.setError, FORM_FIELDS),
  });

  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api.admin.students.setActive(id, isActive),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'student', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });

  if (student.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (student.error || !student.data) {
    return <Alert variant="danger">{bannerMessage(student.error) ?? 'No such student'}</Alert>;
  }

  const detail = student.data;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to={ROUTES.STUDENTS}>
          <ArrowLeft aria-hidden />
          All students
        </Link>
      </Button>

      <PageHeader
        title={detail.fullName ?? detail.mobile}
        description={`+91 ${detail.mobile}`}
        action={
          <Button
            variant={detail.isActive ? 'destructive' : 'secondary'}
            size="sm"
            disabled={setActive.isPending}
            onClick={() => setActive.mutate(!detail.isActive)}
          >
            {detail.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {!detail.isActive ? <Badge variant="danger">Deactivated</Badge> : null}
        <Badge variant={detail.hasSignedIn ? 'success' : 'info'}>
          {detail.hasSignedIn ? 'Has signed in' : 'Never signed in'}
        </Badge>
        <Badge variant={detail.preTestReady ? 'success' : 'neutral'}>
          Pre-test details {detail.preTestReady ? 'on file' : 'needed'}
        </Badge>
        <Badge variant={detail.profileCompleted ? 'success' : 'neutral'}>
          Full profile {detail.profileCompleted ? 'complete' : 'incomplete'}
        </Badge>
      </div>

      {setActive.error ? (
        <Alert variant="danger" className="mb-4">
          {bannerMessage(setActive.error)}
        </Alert>
      ) : null}

      <form
        className="grid gap-5 lg:grid-cols-2"
        onSubmit={form.handleSubmit((values) => {
          setSaved(false);
          save.mutate(values);
        })}
        noValidate
      >
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Mother&apos;s name, father&apos;s name and date of birth are the three the student is
              asked for before a test.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field
              htmlFor="fullName"
              label="Full name"
              error={form.formState.errors.fullName?.message}
            >
              {(control) => <Input {...control} {...form.register('fullName')} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="motherName"
                label="Mother's name"
                error={form.formState.errors.motherName?.message}
              >
                {(control) => <Input {...control} {...form.register('motherName')} />}
              </Field>
              <Field
                htmlFor="fatherName"
                label="Father's name"
                error={form.formState.errors.fatherName?.message}
              >
                {(control) => <Input {...control} {...form.register('fatherName')} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="dob" label="Date of birth" error={form.formState.errors.dob?.message}>
                {(control) => <Input {...control} type="date" {...form.register('dob')} />}
              </Field>
              <Field htmlFor="gender" label="Gender" error={form.formState.errors.gender?.message}>
                {(control) => (
                  <Select {...control} {...form.register('gender')}>
                    <option value="">Not recorded</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </Select>
                )}
              </Field>
            </div>

            <Field htmlFor="email" label="Email" error={form.formState.errors.email?.message}>
              {(control) => <Input {...control} type="email" {...form.register('email')} />}
            </Field>

            <Field htmlFor="address" label="Address" error={form.formState.errors.address?.message}>
              {(control) => <Input {...control} {...form.register('address')} />}
            </Field>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Batches</CardTitle>
              <CardDescription>
                A student reaches tests only through a batch, so they must stay in at least one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batches.data?.items.length ? (
                <div className="max-h-72 overflow-y-auto">
                  {batches.data.items.map((batch) => (
                    <Checkbox
                      key={batch.id}
                      id={`batch-${batch.id}`}
                      label={batch.name}
                      hint={batch.branch ?? undefined}
                      value={batch.id}
                      {...form.register('groupIds')}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No batches yet.{' '}
                  <Link to={ROUTES.BATCHES} className="text-foreground underline">
                    Create one
                  </Link>
                  .
                </p>
              )}
              {form.formState.errors.groupIds ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {form.formState.errors.groupIds.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {save.error ? (
                <Alert variant="danger">{bannerMessage(save.error, FORM_FIELDS)}</Alert>
              ) : null}
              {saved && !form.formState.isDirty ? <Alert variant="success">Saved.</Alert> : null}

              <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                Save changes
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  );
}
