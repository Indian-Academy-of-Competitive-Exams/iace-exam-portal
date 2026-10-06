import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  INSTITUTE_TIME_ZONE,
  changeStudentMobileSchema,
  type ChangeStudentMobileInput,
  type ErasureReceipt,
  type StudentDetail,
} from '@iace/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  FormDialog,
  FormField,
  Input,
  SectionHeading,
  StatRow,
  plural,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { api } from '../../lib/api';
import { QUERY_KEYS, studentQueryKey } from '../../lib/constants';
import { useAuth } from '../../providers/auth';

const MOBILE_FIELDS = ['mobile'] as const;

const REPLACED_ON = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: INSTITUTE_TIME_ZONE,
});

/** The dialog is the confirm: it names what the change costs above the one field it takes. */
function ChangeMobileDialog({
  detail,
  open,
  onOpenChange,
  onChanged,
}: Readonly<{
  detail: StudentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (updated: StudentDetail) => void;
}>) {
  const form = useForm<ChangeStudentMobileInput>({
    resolver: zodResolver(changeStudentMobileSchema),
    defaultValues: { mobile: '' },
  });
  const change = useMutation({
    meta: { success: 'Mobile number changed.', fields: MOBILE_FIELDS },
    mutationFn: (values: ChangeStudentMobileInput) =>
      api.admin.students.changeMobile(detail.id, values),
    onError: (error) => applyFieldErrors(error, form.setError, MOBILE_FIELDS),
    onSuccess: (updated) => {
      // Closed by the parent, which skips the dialog's own reset: the next open must not show this number.
      form.reset();
      onOpenChange(false);
      onChanged(updated);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change mobile number"
      submitLabel="Change number"
      loading={change.isPending}
      form={form}
      onSubmit={(values) => change.mutate(values)}
    >
      <Alert variant="warning">
        They are signed out on every device. On the new number they sign in by OTP and choose a new
        PIN.
      </Alert>
      <FormField form={form} name="mobile" label="New mobile number">
        {(control) => <Input {...control} inputMode="numeric" autoComplete="off" autoFocus />}
      </FormField>
    </FormDialog>
  );
}

/** Everything done TO a student rather than recorded about them, each behind its own confirm. */
export function ActionsTab({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [signInConfirm, setSignInConfirm] = useState(false);
  const [eraseConfirm, setEraseConfirm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isSuperAdmin = useAuth().identity?.isSuperAdmin ?? false;
  const { id, isActive, isTestBlocked } = detail;
  const name = detail.fullName ?? detail.mobile;

  const applyUpdate = (updated: StudentDetail) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS, refetchType: 'none' });
    queryClient.setQueryData(studentQueryKey(id), updated);
  };

  const setTestBlocked = useMutation({
    meta: {
      success: (): string => (isTestBlocked ? 'Tests allowed again.' : 'Blocked from tests.'),
    },
    mutationFn: (next: boolean) => api.admin.students.setTestBlocked(id, { isTestBlocked: next }),
    onError: () => setBlockConfirm(false),
    onSuccess: (updated) => {
      setBlockConfirm(false);
      applyUpdate(updated);
    },
  });

  const setActive = useMutation({
    meta: {
      success: (): string => (isActive ? 'Sign-in suspended.' : 'Sign-in restored.'),
    },
    mutationFn: (next: boolean) => api.admin.students.setActive(id, next),
    onError: () => setSignInConfirm(false),
    onSuccess: (updated) => {
      setSignInConfirm(false);
      applyUpdate(updated);
    },
  });

  const erase = useMutation({
    meta: {
      // The kept sittings are the half nobody expects, so the receipt's own count says it.
      success: (data: unknown): string =>
        `Personal data erased. ${plural((data as ErasureReceipt).attemptsKept, 'sitting')} kept.`,
    },
    mutationFn: () => api.admin.students.erase(id),
    onError: () => setEraseConfirm(false),
    onSuccess: () => {
      setEraseConfirm(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS });
      // The open page is still showing the name that was just erased.
      void queryClient.invalidateQueries({ queryKey: studentQueryKey(id) });
    },
  });

  return (
    <>
      <SectionHeading
        title="Tests"
        action={
          <Button
            type="button"
            size="sm"
            variant={isTestBlocked ? 'secondary' : 'destructive'}
            loading={setTestBlocked.isPending}
            onClick={() => setBlockConfirm(true)}
          >
            {isTestBlocked ? 'Allow tests' : 'Block from tests'}
          </Button>
        }
      />

      <SectionHeading
        title="Mobile number"
        meta={detail.mobile}
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setMobileOpen(true)}>
            Change number
          </Button>
        }
      />
      {detail.formerMobiles.length > 0 ? (
        <div className="flex max-w-sm flex-col gap-2">
          <SectionHeading level={3} title="Previous numbers" />
          {detail.formerMobiles.map((former) => (
            <StatRow
              key={former.replacedAt}
              label={former.mobile}
              value={`Until ${REPLACED_ON.format(new Date(former.replacedAt))}`}
            />
          ))}
        </div>
      ) : null}

      {isSuperAdmin ? (
        <SectionHeading
          title="Sign-in"
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={setActive.isPending}
              onClick={() => setSignInConfirm(true)}
            >
              {isActive ? 'Suspend sign-in' : 'Restore sign-in'}
            </Button>
          }
        />
      ) : null}

      {/* Irreversible and unwinds nothing, so it is the one action kept to a super admin. */}
      {isSuperAdmin ? (
        <SectionHeading
          title="Erasure"
          action={
            <Button
              type="button"
              size="sm"
              variant="destructive"
              loading={erase.isPending}
              onClick={() => setEraseConfirm(true)}
            >
              Erase personal data
            </Button>
          }
        />
      ) : null}

      <ChangeMobileDialog
        detail={detail}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        onChanged={applyUpdate}
      />

      {/* Both directions ask, so a control that changes whether somebody can sit
          an exam never acts on a single click. */}
      <ConfirmDialog
        open={blockConfirm}
        onOpenChange={setBlockConfirm}
        destructive={!isTestBlocked}
        loading={setTestBlocked.isPending}
        title={isTestBlocked ? `Allow ${name} to sit tests again?` : `Block ${name} from tests?`}
        description={
          isTestBlocked
            ? 'They can start tests again straight away, on everything their enrolments and grants reach. Nothing was lost while it was on.'
            : 'They can still sign in and see every test they have already sat, and their results. They cannot start a new one until this is lifted. A session they already have open is not signed out.'
        }
        confirmLabel={isTestBlocked ? 'Allow tests' : 'Block from tests'}
        onConfirm={() => setTestBlocked.mutate(!isTestBlocked)}
      />

      <ConfirmDialog
        open={signInConfirm}
        onOpenChange={setSignInConfirm}
        destructive={isActive}
        loading={setActive.isPending}
        title={isActive ? `Suspend sign-in for ${name}?` : `Restore sign-in for ${name}?`}
        description={
          isActive
            ? 'They cannot sign in at all, on any device. A session they already have open is not revoked; it lasts until its token expires. Their record, attempts and results are kept.'
            : 'They can sign in again. Whether they may sit a test is the other switch, and this does not change it.'
        }
        confirmLabel={isActive ? 'Suspend sign-in' : 'Restore sign-in'}
        onConfirm={() => setActive.mutate(!isActive)}
      />

      <ConfirmDialog
        open={eraseConfirm}
        onOpenChange={setEraseConfirm}
        destructive
        loading={erase.isPending}
        title={`Erase ${name}'s personal data?`}
        description="Their name, contact details, documents and profile are removed for good and cannot be restored. Every sitting they sat is left standing and still counts in results and rankings, but the person is no longer named against them."
        confirmLabel="Erase personal data"
        onConfirm={() => erase.mutate()}
      />
    </>
  );
}
