import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { PIN_LENGTH, changePinSchema, type ChangePinInput } from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { Alert, Button, PageFrame, PageHeader, PinField } from '@iace/ui';
import { api } from '../lib/api';
import { PageBody, SurfaceCard } from '../components/ui';
import { useAuth } from '../providers/auth';

const FORM_FIELDS = ['currentPin', 'newPin'] as const;

/** Changing the PIN. Also where the forced replacement lands for an import's default PIN. */
export function AccountPage() {
  const { identity: student } = useAuth();
  const onDefaultPin = student?.hasDefaultPin ?? false;

  return (
    <PageFrame header={<PageHeader size="display" title="PIN" />}>
      <PageBody>
        <ChangePinCard onDefaultPin={onDefaultPin} />
      </PageBody>
    </PageFrame>
  );
}

export function ChangePinCard({ onDefaultPin }: Readonly<{ onDefaultPin: boolean }>) {
  const { signIn } = useAuth();

  const form = useForm<ChangePinInput>({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPin: '', newPin: '' },
  });

  const change = useMutation({
    meta: { success: 'Your PIN has been changed.', fields: FORM_FIELDS },
    mutationFn: (values: ChangePinInput) => api.me.changePin(values),
    onSuccess: (session) => {
      form.reset();
      // Not optional: the change revoked every session opened with the old PIN, including this one.
      signIn(session);
    },
    onError: (error) => applyFieldErrors(error, form.setError, FORM_FIELDS),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Said plainly: "for your security" tells a student nothing they can act on. */}
      <Alert variant={onDefaultPin ? 'warning' : 'info'}>
        {onDefaultPin
          ? `Your PIN is the first ${PIN_LENGTH} digits of your mobile number, set for you when you were enrolled. Anyone holding the class list can work it out — pick your own.`
          : `Any ${PIN_LENGTH} digits. Changing it signs you out everywhere else.`}
      </Alert>

      <SurfaceCard title={onDefaultPin ? 'Choose your own PIN' : 'Change your PIN'}>
        <form
          className="flex max-w-xs flex-col gap-4"
          onSubmit={form.handleSubmit((values) => change.mutate(values))}
          noValidate
        >
          <PinField
            name="currentPin"
            form={form}
            label={onDefaultPin ? 'PIN you were given' : 'Current PIN'}
            length={PIN_LENGTH}
            masked
            autoComplete="current-password"
            /* ui-copy-ok: format */ hint={
              onDefaultPin ? 'The first four digits of your mobile number.' : undefined
            }
          />

          <PinField
            name="newPin"
            form={form}
            label={`New PIN (${PIN_LENGTH} digits)`}
            length={PIN_LENGTH}
            masked
            autoComplete="new-password"
          />

          <Button type="submit" loading={change.isPending}>
            Save new PIN
          </Button>
        </form>
      </SurfaceCard>
    </div>
  );
}
