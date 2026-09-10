import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import {
  DOCUMENT_KINDS,
  EARLIEST_BIRTH_DATE,
  GENDERS,
  todayISO,
  updateMeSchema,
  type EnrolmentName,
  type Me,
  type UpdateMeInput,
  type Gender,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  DatePicker,
  Field,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  SkeletonParagraph,
  StatRow,
  Textarea,
} from '@iace/ui';
import { DocumentCard } from '../components/document-card';
import { HistoryEditor } from '../components/history-editor';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { PageCrumbs } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { courseLabel, ME_QUERY_KEY, NAV_ITEMS, PROFILE_QUERY_KEY } from '../lib/constants';

/** The names the FORM registers. The server keys errors the same way, and matches on the leaf too. */
const FORM_FIELDS = [
  'fullName',
  'profile.motherName',
  'profile.fatherName',
  'profile.dob',
  'profile.email',
  'profile.address',
  'profile.gender',
] as const;

/** One page in two states: view mode is the same fields, inert, so nothing moves on Edit. */
export function ProfilePage() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  const form = useForm<UpdateMeInput>({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { fullName: '', profile: { educationDetails: [], pastExamHistory: [] } },
  });
  const gender = useWatch({ control: form.control, name: 'profile.gender' });
  const dob = useWatch({ control: form.control, name: 'profile.dob' });

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
    // `fields` keeps a validation failure off the toast and on the input that caused it.
    meta: { success: 'Your details have been saved.', fields: FORM_FIELDS },
    mutationFn: (values: UpdateMeInput) => api.me.update(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      // The identity carries preTestReady, and saving these fields is exactly
      // what changes it — without this the prompt would still be there.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      form.reset(form.getValues());
      setIsEditing(false);
    },
    onError: (error) => applyFieldErrors(error, form.setError, FORM_FIELDS),
  });

  const ready = !me.isPending && !me.error;

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        ready && isEditing ? (
          <>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset();
                setIsEditing(false);
              }}
            >
              Discard
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </>
        ) : undefined
      }
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          size="display"
          title="Profile"
          action={
            ready && !isEditing ? (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil aria-hidden />
                Edit details
              </Button>
            ) : undefined
          }
        />
      }
    >
      {me.data ? (
        <PreTestPrompt preTestReady={me.data.preTestReady} onAdd={() => setIsEditing(true)} />
      ) : null}

      {me.isPending && <SkeletonParagraph lines={8} />}
      {me.error && <Alert variant="danger">Could not load your details.</Alert>}
      {ready && me.data && (
        <>
          <FormSection title="Needed before a test">
            <div className="grid gap-4 sm:grid-cols-2">
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
                  // Bounded both ends: a picker offering what the server refuses is a dead end.
                  <DatePicker
                    {...control}
                    min={EARLIEST_BIRTH_DATE}
                    max={todayISO()}
                    value={dob ?? ''}
                    onChange={(next) =>
                      form.setValue('profile.dob', next || null, { shouldDirty: true })
                    }
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="About you">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="fullName"
                label="Full name"
                error={form.formState.errors.fullName?.message}
              >
                {(control) => <Input {...control} {...form.register('fullName')} />}
              </Field>

              <Field htmlFor="mobile" label="Mobile">
                {/* The one field an admin owns; it is here so the page shows the whole record. */}
                {(control) => <Input {...control} readOnly value={`+91 ${me.data.mobile}`} />}
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
                  <Combobox
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    aria-invalid={control['aria-invalid']}
                    clearable={false}
                    value={gender ?? ''}
                    onChange={(next) =>
                      form.setValue('profile.gender', (next || null) as Gender | null, {
                        shouldDirty: true,
                      })
                    }
                    items={[
                      { value: '', label: 'Prefer not to say' },
                      ...GENDERS.map((value) => ({
                        value,
                        label: value.charAt(0) + value.slice(1).toLowerCase(),
                      })),
                    ]}
                  />
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
            </div>
          </FormSection>

          <Standing me={me.data} />

          <FormSection title="Your documents">
            <div className="flex flex-wrap gap-4">
              <DocumentCard
                kind={DOCUMENT_KINDS.PHOTO}
                label="Passport photo"
                url={me.data.profile?.photoUrl ?? null}
              />
              <DocumentCard
                kind={DOCUMENT_KINDS.TENTH_MARKSHEET}
                label="Class 10 marksheet"
                url={me.data.profile?.tenthMarksheetUrl ?? null}
              />
            </div>
          </FormSection>

          <HistoryEditor
            control={form.control}
            name="profile.educationDetails"
            title="Education"
            addLabel="Add a qualification"
            empty="No qualifications added yet"
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
            addLabel="Add an exam"
            empty="No previous exams added yet"
            columns={[
              { key: 'exam', label: 'Exam', span: 3 },
              { key: 'year', label: 'Year', type: 'number', span: 1.4 },
              { key: 'result', label: 'Result', span: 3 },
            ]}
            emptyRow={{ exam: '', year: '', result: '' }}
          />
        </>
      )}
    </FormPanel>
  );
}

const NONE_RECORDED = 'None recorded';

/** Read-only on purpose: enrolment, branch and verification are the admin's to set, not theirs. */
function Standing({ me }: Readonly<{ me: Me }>) {
  const { enrolment } = me;

  return (
    <FormSection title="Enrolment">
      <div className="flex flex-col gap-3">
        <StatRow label="Branch" value={enrolment.branch ?? NONE_RECORDED} />
        <StatRow label="Course" value={<Names names={me.enrolledCourses.map(courseLabel)} />} />
        <StatRow label="Programs" value={<Names names={enrolment.programs.map(nameOf)} />} />
        <StatRow label="Exams" value={<Names names={enrolment.exams.map(nameOf)} />} />
        <StatRow
          label="Aadhaar"
          value={<Verified isVerified={me.profile?.aadhaarVerified ?? false} />}
        />
        <StatRow label="PAN" value={<Verified isVerified={me.profile?.panVerified ?? false} />} />
      </div>
    </FormSection>
  );
}

const nameOf = (entry: EnrolmentName) => entry.name;

/** Every one of them, wrapped — this IS the detail screen, so nothing here hides behind a `+N`. */
function Names({ names }: Readonly<{ names: readonly string[] }>) {
  if (names.length === 0) return <span className="text-muted-foreground">{NONE_RECORDED}</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {names.map((name) => (
        <Badge key={name} variant="neutral">
          {name}
        </Badge>
      ))}
    </span>
  );
}

/** Never the number and never the image — the platform stores only whether it was checked. */
const Verified = ({ isVerified }: Readonly<{ isVerified: boolean }>) =>
  isVerified ? (
    <Badge variant="success">Verified</Badge>
  ) : (
    <Badge variant="neutral">Not verified</Badge>
  );
