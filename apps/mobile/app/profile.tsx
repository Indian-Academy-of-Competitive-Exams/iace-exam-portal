/// <reference types="nativewind/types" />
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors } from '@iace/app-kit';
import { GENDERS, updateMeSchema, type Gender, type Me, type UpdateMeInput } from '@iace/contracts';
import { api } from '../src/lib/api';
import { ME_QUERY_KEY, PROFILE_QUERY_KEY } from '../src/lib/constants';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { ChipRow, type ChipOption } from '../src/components/ui/chip-row';
import { EmptyState, EMPTY_STATE_KINDS } from '../src/components/ui/empty-state';
import { Skeleton } from '../src/components/ui/skeleton';
import { TextField } from '../src/components/ui/text-field';

const DASH = '—';

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

const GENDER_OPTIONS: readonly ChipOption[] = GENDERS.map((value) => ({
  value,
  label: `${value.charAt(0)}${value.slice(1).toLowerCase()}`,
}));

/** Their own record: what the institute holds, and the fields they may set themselves. */
export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  const form = useForm({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { fullName: '', profile: {} } as UpdateMeInput,
  });

  const { reset } = form;
  useEffect(() => {
    if (me.data) reset(valuesOf(me.data));
  }, [me.data, reset]);

  const save = useMutation({
    mutationFn: (values: UpdateMeInput) => api.me.update(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
      // The identity carries preTestReady, and these are the fields that decide it.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      reset(valuesOf(updated));
      setIsEditing(false);
    },
    // Explicit type argument: this app's own react-hook-form copy is a separate install from app-kit's.
    onError: (error) => applyFieldErrors<UpdateMeInput>(error, form.setError, FORM_FIELDS),
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
          title="Your details did not load"
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
          <Alert variant="warning">
            Before your first test we need your mother&rsquo;s name, father&rsquo;s name and date of
            birth — they go on your hall ticket.
          </Alert>
        )}

        <Enrolment me={me.data} />

        {isEditing ? (
          <View className="gap-4">
            <Text className="text-lg font-semibold text-foreground">Your details</Text>
            <TextField control={form.control} name="fullName" label="Full name" />
            <TextField control={form.control} name="profile.motherName" label="Mother's name" />
            <TextField control={form.control} name="profile.fatherName" label="Father's name" />
            <TextField
              control={form.control}
              name="profile.dob"
              label="Date of birth"
              // ui-copy-ok: format — the field takes a typed date, not a calendar
              hint="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
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
                  onChange={(next) => field.onChange(next as Gender)}
                />
              )}
            />

            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => {
                  reset(valuesOf(me.data));
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={save.isPending}
                onPress={form.handleSubmit((values) => save.mutate(values))}
              >
                Save
              </Button>
            </View>
          </View>
        ) : (
          <View className="gap-4">
            <Text className="text-lg font-semibold text-foreground">Your details</Text>
            <Rows rows={detailsOf(me.data)} />
            <Button variant="outline" onPress={() => setIsEditing(true)}>
              Edit your details
            </Button>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** What the institute holds them on, and none of it theirs to change. */
function Enrolment({ me }: Readonly<{ me: Me }>) {
  return (
    <View className="gap-4">
      <Text className="text-lg font-semibold text-foreground">Enrolment</Text>
      <Rows
        rows={[
          { label: 'Branch', value: me.enrolment.branch },
          { label: 'Exams', value: me.enrolment.exams.map((one) => one.name).join(', ') },
          { label: 'Programs', value: me.enrolment.programs.map((one) => one.name).join(', ') },
        ]}
      />
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
          <Text className="text-xs text-muted-foreground">{row.label}</Text>
          <Text className="text-sm text-foreground">{row.value || DASH}</Text>
        </View>
      ))}
    </Card>
  );
}

const detailsOf = (me: Me): DetailRow[] => [
  { label: 'Full name', value: me.fullName },
  { label: 'Mobile number', value: me.mobile },
  { label: "Mother's name", value: me.profile?.motherName },
  { label: "Father's name", value: me.profile?.fatherName },
  { label: 'Date of birth', value: me.profile?.dob },
  { label: 'Email', value: me.profile?.email },
  { label: 'Address', value: me.profile?.address },
  { label: 'Gender', value: me.profile?.gender },
];

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
    },
  };
}
