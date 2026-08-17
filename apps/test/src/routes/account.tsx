import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { PIN_LENGTH, changePinSchema, type ChangePinInput } from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  PageHeader,
  PinInput,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';

const FORM_FIELDS = ['currentPin', 'newPin'] as const;

/**
 * Changing the PIN.
 *
 * Reachable on its own, and also where the forced replacement lands when a
 * student is still on the PIN an import gave them.
 */
export function AccountPage() {
  const { identity: student } = useAuth();
  const onDefaultPin = student?.hasDefaultPin ?? false;

  return (
    <>
      <PageHeader
        title="Change PIN"
        description="You sign in with your mobile number and a four-digit PIN."
      />
      <ChangePinCard onDefaultPin={onDefaultPin} />
    </>
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
      // Storing the returned session is NOT optional: changing the PIN revoked
      // every session opened with the old one, including this device's. The
      // tokens in hand stopped working the moment this succeeded. It also
      // carries the identity with hasDefaultPin now false, which is what takes
      // the forced prompt away.
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
            control={form.control}
            label={onDefaultPin ? 'PIN you were given' : 'Current PIN'}
            autoComplete="current-password"
            error={form.formState.errors.currentPin?.message}
            hint={onDefaultPin ? 'The first four digits of your mobile number.' : undefined}
          />

          <PinField
            name="newPin"
            control={form.control}
            label="New PIN"
            autoComplete="new-password"
            error={form.formState.errors.newPin?.message}
            hint={`${PIN_LENGTH} digits.`}
          />

          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save new PIN
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * A PIN as four boxes, wired to react-hook-form.
 *
 * `Controller` rather than `register`: the boxes RENDER the value, so an
 * uncontrolled input would keep the digits somewhere nothing re-reads — and the
 * `form.reset()` after a successful change would leave four filled boxes
 * standing over an empty field.
 */
function PinField({
  name,
  control,
  label,
  autoComplete,
  hint,
  error,
}: Readonly<{
  name: FieldPath<ChangePinInput>;
  control: Control<ChangePinInput>;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
}>) {
  return (
    <Field htmlFor={name} label={label} hint={hint} error={error}>
      {(wiring) => (
        <Controller
          name={name}
          control={control}
          render={({ field: { value, ...field } }) => (
            <PinInput
              {...wiring}
              {...field}
              value={value}
              length={PIN_LENGTH}
              masked
              autoComplete={autoComplete}
              invalid={Boolean(error)}
            />
          )}
        />
      )}
    </Field>
  );
}
