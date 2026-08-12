import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { PIN_LENGTH, changePinSchema, type ChangePinInput } from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  NumericInput,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth-context';

const FORM_FIELDS = ['currentPin', 'newPin'] as const;

/**
 * Changing the PIN.
 *
 * Reachable on its own, and also where the forced replacement lands when a
 * student is still on the PIN an import gave them.
 */
export function AccountPage() {
  const { student } = useAuth();
  const onDefaultPin = student?.hasDefaultPin ?? false;

  return (
    <>
      <PageHeader
        title="Your sign-in"
        description="You sign in with your mobile number and a four-digit PIN."
      />
      <ChangePinCard onDefaultPin={onDefaultPin} />
    </>
  );
}

export function ChangePinCard({ onDefaultPin }: { onDefaultPin: boolean }) {
  const { signIn } = useAuth();

  const form = useForm<ChangePinInput>({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPin: '', newPin: '' },
  });

  const change = useMutation({
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

  const banner = change.error ? bannerMessage(change.error, FORM_FIELDS) : null;

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
          <Field
            htmlFor="currentPin"
            label={onDefaultPin ? 'PIN you were given' : 'Current PIN'}
            error={form.formState.errors.currentPin?.message}
            hint={onDefaultPin ? 'The first four digits of your mobile number.' : undefined}
          >
            {(control) => (
              <NumericInput
                {...control}
                {...form.register('currentPin')}
                masked
                maxLength={PIN_LENGTH}
                autoComplete="current-password"
              />
            )}
          </Field>

          <Field
            htmlFor="newPin"
            label="New PIN"
            error={form.formState.errors.newPin?.message}
            hint={`${PIN_LENGTH} digits.`}
          >
            {(control) => (
              <NumericInput
                {...control}
                {...form.register('newPin')}
                masked
                maxLength={PIN_LENGTH}
                autoComplete="new-password"
              />
            )}
          </Field>

          {banner ? <Alert variant="danger">{banner}</Alert> : null}
          {change.isSuccess ? (
            <Alert variant="success">
              <span className="flex items-center gap-2">
                <Check className="size-4" aria-hidden />
                Your PIN has been changed.
              </span>
            </Alert>
          ) : null}

          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save new PIN
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
