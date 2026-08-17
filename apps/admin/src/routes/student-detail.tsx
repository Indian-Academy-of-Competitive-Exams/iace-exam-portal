import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { ArrowLeft, FileText, Save } from 'lucide-react';
import { todayISO, type Gender, type StudentDetail } from '@iace/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from '@iace/ui';
import { GroupPicker } from '../components/group-picker';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors } from '@iace/app-kit';

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

/**
 * One uploaded document, if it exists.
 *
 * Opens in a new tab: these are signed links with a short life, and navigating
 * the admin away from the record they were reading to look at a PDF means
 * finding their way back.
 */
function DocumentLink({ label, url }: Readonly<{ label: string; url?: string | null }>) {
  if (!url) {
    return <Badge variant="neutral">{label} — not uploaded</Badge>;
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer">
        <FileText aria-hidden />
        {label}
      </a>
    </Button>
  );
}

/** The three sign-in states, listed. Mirrors SignInStatus on the roster. */
function SignInBadge({ detail }: Readonly<{ detail: StudentDetail }>) {
  if (detail.hasSignedIn) return <Badge variant="success">Has signed in</Badge>;
  if (detail.hasDefaultPin) return <Badge variant="warning">Default PIN — not yet changed</Badge>;
  return <Badge variant="info">Never signed in</Badge>;
}

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const student = useQuery({
    queryKey: ['admin', 'student', id],
    queryFn: () => api.admin.students.detail(id),
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

  // useWatch rather than form.watch(): the latter returns a fresh function each
  // render and cannot be memoized, so it re-renders the picker on every keystroke
  // anywhere in the form.
  const selectedGroupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];

  // The form is created before the student arrives, so seed it on load — and
  // only when the id changes, or an in-progress edit would be wiped by a
  // background refetch.
  useEffect(() => {
    if (student.data) form.reset(toFormValues(student.data));
  }, [student.data?.id]);

  const save = useMutation({
    meta: { success: 'Saved.', fields: FORM_FIELDS },
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
    onError: (error) => {
      applyFieldErrors(error, form.setError, FORM_FIELDS);
      // Bring the offending field into view; on a long form the message can
      // otherwise land above the fold.
      requestAnimationFrame(() => {
        document
          .querySelector('[aria-invalid="true"], [role="alert"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
  });

  const setActive = useMutation({
    meta: {
      success: (): string => (detail?.isActive ? 'Student deactivated.' : 'Student reactivated.'),
    },
    mutationFn: (isActive: boolean) => api.admin.students.setActive(id, isActive),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'student', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });

  if (student.isPending) return <LoadingState />;
  if (student.error || !student.data) {
    // The reason is on the toast; this only has to stop the page being blank.
    return <Alert variant="danger">Could not load this student.</Alert>;
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
            loading={setActive.isPending}
            onClick={() => setActive.mutate(!detail.isActive)}
          >
            {detail.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Avatar
          src={detail.profile?.photoUrl}
          name={detail.fullName}
          fallback={detail.mobile}
          size="md"
        />
        {!detail.isActive ? <Badge variant="danger">Deactivated</Badge> : null}
        <SignInBadge detail={detail} />
        <Badge variant={detail.preTestReady ? 'success' : 'neutral'}>
          Pre-test details {detail.preTestReady ? 'on file' : 'needed'}
        </Badge>
        <Badge variant={detail.profileCompleted ? 'success' : 'neutral'}>
          Full profile {detail.profileCompleted ? 'complete' : 'incomplete'}
        </Badge>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Documents the student has uploaded</CardTitle>
          <CardDescription>
            Read-only here — only the student can replace them. Links expire after a few minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <DocumentLink label="Passport photo" url={detail.profile?.photoUrl} />
          <DocumentLink label="Aadhaar" url={detail.profile?.aadhaarUrl} />
          <DocumentLink label="PAN" url={detail.profile?.panUrl} />
        </CardContent>
      </Card>

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
                {/* The browser's own picker refuses a future date too, so the
                    rule is visible before it is enforced. */}
                {(control) => (
                  <Input {...control} type="date" max={todayISO()} {...form.register('dob')} />
                )}
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
              <CardTitle>Groups</CardTitle>
              <CardDescription>
                A student reaches tests only through a group, so they must stay in at least one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GroupPicker
                idPrefix="group"
                register={form.register('groupIds')}
                selectedIds={selectedGroupIds}
                known={detail.groups}
                error={form.formState.errors.groupIds?.message}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {save.error ? (
                // Always says something HERE, beside the button that was just
                // clicked. When every detail is already on a field, that field
                // may be a card away and off screen, and a save that reports
                // nothing where you are looking reads as a dead button.
                <Alert variant="danger">Check the highlighted fields above.</Alert>
              ) : null}
              {saved && !form.formState.isDirty ? <Alert variant="success">Saved.</Alert> : null}

              <Button
                type="submit"
                icon={<Save aria-hidden />}
                loading={save.isPending}
                disabled={!form.formState.isDirty}
              >
                Save changes
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  );
}
