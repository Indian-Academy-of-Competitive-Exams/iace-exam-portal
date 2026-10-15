/// <reference types="nativewind/types" />
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors, PROFILE_FORM_FIELDS, saveOwnDetails } from '@iace/app-kit';
import {
  courseLabel,
  DOCUMENT_KINDS,
  EARLIEST_BIRTH_DATE,
  GENDERS,
  ownDetailsMoved,
  todayISO,
  updateMeSchema,
  type EnrolmentName,
  type Gender,
  type Me,
  type UpdateMeInput,
} from '@iace/contracts';
import { Text } from '../src/components/ui/text';
import { api } from '../src/lib/api';
import { ME_QUERY_KEY, PROFILE_QUERY_KEY } from '../src/lib/constants';
import { DocumentCard } from '../src/components/account/document-card';
import { HistoryEditor, type HistoryColumn } from '../src/components/account/history-editor';
import { Alert } from '../src/components/ui/alert';
import { Badge } from '../src/components/ui/badge';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { ChipRow, type ChipOption } from '../src/components/ui/chip-row';
import { DateField } from '../src/components/ui/date-field';
import { EmptyState } from '../src/components/ui/empty-state';
import { EMPTY_STATE_KINDS } from '../src/components/ui/empty-state-kinds';
import { Skeleton } from '../src/components/ui/skeleton';
import { TextField } from '../src/components/ui/text-field';
import UserPen from 'lucide-react-native/icons/user-pen';
import Undo2 from 'lucide-react-native/icons/undo-2';
import Check from 'lucide-react-native/icons/check';
import PencilLine from 'lucide-react-native/icons/pencil-line';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Files from 'lucide-react-native/icons/files';
import { SectionTitle } from '../src/components/ui/section-title';
import UserRound from 'lucide-react-native/icons/user-round';

const DASH = '—';

const NO_GENDER = '';

const GENDER_OPTIONS: readonly ChipOption[] = [
  { value: NO_GENDER, label: 'Prefer not to say' },
  ...GENDERS.map((value) => ({
    value,
    label: `${value.charAt(0)}${value.slice(1).toLowerCase()}`,
  })),
];

/** Their own record: what the institute holds, and the fields they may set themselves. */
export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  // The record the open edit began on; what was written elsewhere since is measured against it.
  const [opened, setOpened] = useState<Me | null>(null);
  const profileQuery = { queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() };
  const me = useQuery(profileQuery);
  const moved = isEditing ? ownDetailsMoved(opened, me.data) : [];

  const edit = () => {
    setOpened(me.data ?? null);
    setIsEditing(true);
  };

  const form = useForm({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { fullName: '', profile: {} } as UpdateMeInput,
  });

  // Follows the record until an edit starts: an upload or a refetch mid-edit must not wipe what was typed.
  const { reset } = form;
  useEffect(() => {
    if (me.data && !isEditing) reset(valuesOf(me.data));
  }, [me.data, reset, isEditing]);

  const save = useMutation({
    meta: { success: 'Your details have been saved.', fields: PROFILE_FORM_FIELDS },
    mutationFn: (values: UpdateMeInput) =>
      saveOwnDetails(api, queryClient, opened, me.data, values),
    onSuccess: (updated) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      // Re-read as well: an upload answering after this would otherwise put back the record it left with.
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      // The identity carries preTestReady, and these are the fields that decide it.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      reset(valuesOf(updated));
      setIsEditing(false);
    },
    // Explicit type argument: this app's own react-hook-form copy is a separate install from app-kit's.
    onError: (error) => applyFieldErrors<UpdateMeInput>(error, form.setError, PROFILE_FORM_FIELDS),
  });

  if (me.isLoading) {
    return (
      <View className="flex-1 gap-3 bg-background px-5 py-6">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </View>
    );
  }

  if (!me.data) {
    return (
      <View className="flex-1 justify-center bg-background px-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load your details"
          onRetry={() => void me.refetch()}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-6 px-5 py-6" keyboardShouldPersistTaps="handled">
        {me.data.preTestReady ? null : (
          <Alert
            variant="warning"
            action={
              isEditing ? null : (
                <Button size="sm" icon={UserPen} onPress={edit}>
                  Add them
                </Button>
              )
            }
          >
            Before your first test we need your mother&rsquo;s name, father&rsquo;s name and date of
            birth. They go on your hall ticket.
          </Alert>
        )}

        <Enrolment me={me.data} />

        {isEditing ? (
          <View className="gap-4">
            <SectionTitle icon={UserRound}>Your details</SectionTitle>
            <TextField control={form.control} name="fullName" label="Full name" />
            <TextField control={form.control} name="profile.motherName" label="Mother's name" />
            <TextField control={form.control} name="profile.fatherName" label="Father's name" />
            <DateField
              control={form.control}
              name="profile.dob"
              label="Date of birth"
              minimum={EARLIEST_BIRTH_DATE}
              maximum={todayISO()}
            />
            <TextField
              control={form.control}
              name="profile.email"
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextField
              control={form.control}
              name="profile.address"
              label="Address"
              multiline
              className="h-24 py-2"
            />

            <Controller
              control={form.control}
              name="profile.gender"
              render={({ field }) => (
                <ChipRow
                  label="Gender"
                  options={GENDER_OPTIONS}
                  value={typeof field.value === 'string' ? field.value : ''}
                  onChange={(next) => field.onChange((next || null) as Gender | null)}
                />
              )}
            />

            <HistoryEditor
              control={form.control}
              name="profile.educationDetails"
              title="Education"
              addLabel="Add a qualification"
              empty="No qualifications added yet"
              columns={EDUCATION_COLUMNS}
              emptyRow={EMPTY_EDUCATION}
            />

            <HistoryEditor
              control={form.control}
              name="profile.pastExamHistory"
              title="Exams sat elsewhere"
              addLabel="Add an exam"
              empty="No previous exams added yet"
              columns={EXAM_COLUMNS}
              emptyRow={EMPTY_EXAM}
            />

            {moved.length > 0 ? (
              <Alert variant="warning">
                Changed elsewhere since you began editing: {moved.join(', ')}. Discard, then edit
                again from your details as they stand.
              </Alert>
            ) : null}

            <View className="flex-row gap-2">
              <Button
                variant="secondary"
                icon={Undo2}
                className="flex-1"
                disabled={save.isPending}
                onPress={() => {
                  reset(valuesOf(me.data));
                  setIsEditing(false);
                }}
              >
                Discard
              </Button>
              <Button
                icon={Check}
                className="flex-1"
                loading={save.isPending}
                disabled={!form.formState.isDirty || moved.length > 0}
                onPress={form.handleSubmit((values) => save.mutate(values))}
              >
                Save changes
              </Button>
            </View>
          </View>
        ) : (
          <View className="gap-4">
            <SectionTitle icon={UserRound}>Your details</SectionTitle>
            <Rows rows={detailsOf(me.data)} />
            <Button variant="outline" icon={PencilLine} onPress={edit}>
              Edit your details
            </Button>

            <History title="Education" lines={educationLines(me.data)} />
            <History title="Exams sat elsewhere" lines={examLines(me.data)} />
          </View>
        )}

        <Documents me={me.data} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** What the institute holds them on, and none of it theirs to change. */
function Enrolment({ me }: Readonly<{ me: Me }>) {
  const { enrolment } = me;

  return (
    <View className="gap-4">
      <SectionTitle icon={GraduationCap}>Enrolment</SectionTitle>
      <Rows rows={[{ label: 'Branch', value: enrolment.branch ?? NONE_RECORDED }]} />
      <Card>
        <Names label="Course" names={me.enrolledCourses.map(courseLabel)} />
        <Names label="Programs" names={enrolment.programs.map(nameOf)} divided />
        <Names label="Exams" names={enrolment.exams.map(nameOf)} divided />
        <Verified label="Aadhaar" isVerified={me.profile?.aadhaarVerified ?? false} />
        <Verified label="PAN" isVerified={me.profile?.panVerified ?? false} />
      </Card>
    </View>
  );
}

const NONE_RECORDED = 'None recorded';

const nameOf = (entry: EnrolmentName) => entry.name;

function Names({
  label,
  names,
  divided = false,
}: Readonly<{ label: string; names: readonly string[]; divided?: boolean }>) {
  return (
    <View className={divided ? 'gap-2 border-t border-border p-4' : 'gap-2 p-4'}>
      <Text variant="meta">{label}</Text>
      {names.length === 0 ? (
        <Text variant="muted">{NONE_RECORDED}</Text>
      ) : (
        <View className="flex-row flex-wrap gap-1.5">
          {names.map((name) => (
            <Badge key={name}>{name}</Badge>
          ))}
        </View>
      )}
    </View>
  );
}

/** Never the number and never the image — the platform stores only whether it was checked. */
function Verified({ label, isVerified }: Readonly<{ label: string; isVerified: boolean }>) {
  return (
    <View className="gap-2 border-t border-border p-4">
      <Text variant="meta">{label}</Text>
      <Badge variant={isVerified ? 'success' : 'neutral'}>
        {isVerified ? 'Verified' : 'Not verified'}
      </Badge>
    </View>
  );
}

interface DetailRow {
  label: string;
  value: string | null | undefined;
}

function Rows({ rows }: Readonly<{ rows: readonly DetailRow[] }>) {
  return (
    <Card>
      {rows.map((row, index) => (
        <View
          key={row.label}
          className={index > 0 ? 'gap-1 border-t border-border p-4' : 'gap-1 p-4'}
        >
          <Text variant="meta">{row.label}</Text>
          <Text variant="body">{row.value || DASH}</Text>
        </View>
      ))}
    </Card>
  );
}

const detailsOf = (me: Me): DetailRow[] => [
  { label: 'Full name', value: me.fullName },
  { label: 'Mobile', value: me.mobile },
  { label: "Mother's name", value: me.profile?.motherName },
  { label: "Father's name", value: me.profile?.fatherName },
  { label: 'Date of birth', value: me.profile?.dob },
  { label: 'Email', value: me.profile?.email },
  { label: 'Address', value: me.profile?.address },
  {
    label: 'Gender',
    value: GENDER_OPTIONS.find((one) => one.value === me.profile?.gender)?.label,
  },
];

const EDUCATION_COLUMNS: readonly HistoryColumn[] = [
  { key: 'level', label: 'Qualification' },
  { key: 'board', label: 'Board or university' },
  { key: 'institution', label: 'Institution' },
  { key: 'year', label: 'Year', keyboardType: 'number-pad' },
  { key: 'percentage', label: 'Percentage', keyboardType: 'decimal-pad' },
];

const EXAM_COLUMNS: readonly HistoryColumn[] = [
  { key: 'exam', label: 'Exam' },
  { key: 'year', label: 'Year', keyboardType: 'number-pad' },
  { key: 'result', label: 'Result' },
];

const EMPTY_EDUCATION = { level: '', board: '', institution: '', year: '', percentage: '' };
const EMPTY_EXAM = { exam: '', year: '', result: '' };

/** The photo goes on a hall ticket; the marksheet is a certificate, and both are theirs to replace. */
function Documents({ me }: Readonly<{ me: Me }>) {
  return (
    <View className="gap-4">
      <SectionTitle icon={Files}>Your documents</SectionTitle>
      <View className="flex-row gap-3">
        <DocumentCard
          kind={DOCUMENT_KINDS.PHOTO}
          label="Passport photo"
          url={me.profile?.photoUrl ?? null}
        />
        <DocumentCard
          kind={DOCUMENT_KINDS.TENTH_MARKSHEET}
          label="Class 10 marksheet"
          url={me.profile?.tenthMarksheetUrl ?? null}
        />
      </View>
    </View>
  );
}

function History({ title, lines }: Readonly<{ title: string; lines: readonly string[] }>) {
  if (lines.length === 0) return null;

  return (
    <View className="gap-3">
      <Text variant="section">{title}</Text>
      <Card>
        {lines.map((line, index) => (
          <View key={line} className={index > 0 ? 'border-t border-border p-4' : 'p-4'}>
            <Text variant="body">{line}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

const educationLines = (me: Me): string[] =>
  (me.profile?.educationDetails ?? []).map((row) =>
    [row.level, row.institution, row.board, row.year, percent(row.percentage)]
      .filter(Boolean)
      .join(' · '),
  );

const examLines = (me: Me): string[] =>
  (me.profile?.pastExamHistory ?? []).map((row) =>
    [row.exam, row.year, row.result].filter(Boolean).join(' · '),
  );

const percent = (value: number | undefined) => (value === undefined ? '' : `${value}%`);

/** A number in the record is a string in the form, or its field renders blank and saves blank. */
const typed = (value: number | undefined) => (value === undefined ? '' : String(value));

function valuesOf(me: Me): UpdateMeInput {
  return {
    fullName: me.fullName ?? '',
    profile: {
      motherName: me.profile?.motherName ?? '',
      fatherName: me.profile?.fatherName ?? '',
      dob: me.profile?.dob ?? '',
      email: me.profile?.email ?? '',
      address: me.profile?.address ?? '',
      gender: me.profile?.gender ?? undefined,
      educationDetails: (me.profile?.educationDetails ?? []).map((row) => ({
        ...row,
        year: typed(row.year),
        percentage: typed(row.percentage),
      })),
      pastExamHistory: (me.profile?.pastExamHistory ?? []).map((row) => ({
        ...row,
        year: typed(row.year),
      })),
    },
  };
}
