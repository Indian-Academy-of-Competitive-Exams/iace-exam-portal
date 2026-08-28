import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PIN_LENGTH, changePinSchema, type ChangePinInput } from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageFrame,
  PageHeader,
  PinField,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';

const FORM_FIELDS = ['currentPin', 'newPin'] as const;

/** Changing the PIN. Also where the forced replacement lands for an import's default PIN. */
export function AccountPage() {
  const { identity: student } = useAuth();
  const onDefaultPin = student?.hasDefaultPin ?? false;

  return (
    <PageFrame header={<PageHeader title="Change PIN" />}>
      <ChangePinCard onDefaultPin={onDefaultPin} />
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden />
          {onDefaultPin ? 'Choose your own PIN' : 'Change your PIN'}
        </CardTitle>
        <CardDescription>
          {onDefaultPin
            ? // Said plainly. A student who does not know the PIN is guessable
              // has no reason to change it, and "for your security" tells them
              // nothing they can act on.
              `Your PIN is currently the first ${PIN_LENGTH} digits of your mobile number, set for you when you were enrolled. Anyone with the class list can work it out — pick your own.`
            : `Any ${PIN_LENGTH} digits. Changing it signs you out everywhere else.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
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
      </CardContent>
    </Card>
  );
}
