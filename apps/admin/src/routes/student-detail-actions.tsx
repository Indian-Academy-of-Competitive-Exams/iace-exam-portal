import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ErasureReceipt, type StudentDetail } from '@iace/contracts';
import { Button, ConfirmDialog, SectionHeading, plural } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** Everything done TO a student rather than recorded about them, each behind its own confirm. */
export function ActionsTab({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [signInConfirm, setSignInConfirm] = useState(false);
  const [eraseConfirm, setEraseConfirm] = useState(false);
  const isSuperAdmin = useAuth().identity?.isSuperAdmin ?? false;
  const { id, isActive, isTestBlocked } = detail;
  const name = detail.fullName ?? detail.mobile;

  const applyUpdate = (updated: StudentDetail) => {
    queryClient.setQueryData([...QUERY_KEYS.STUDENT, id], updated);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS });
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
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.STUDENT, id] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS });
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
            ? 'They cannot sign in at all, on any device. A session they already have open is not revoked — it lasts until its token expires. Their record, attempts and results are kept.'
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
        description="Their name, contact details, documents and profile are removed for good and cannot be restored. Every sitting they sat is left standing and still counts in results and rankings — the person is no longer named against them."
        confirmLabel="Erase personal data"
        onConfirm={() => erase.mutate()}
      />
    </>
  );
}
