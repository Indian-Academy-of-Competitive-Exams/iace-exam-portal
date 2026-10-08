import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { otpCodeFormSchema, requestAdminOtpSchema, type OtpRequestResponse } from '@iace/contracts';
import {
  Alert,
  Brandmark,
  Button,
  Card,
  CardStep,
  Field,
  Input,
  PinField,
  ThemeToggle,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ROUTES } from '../../lib/constants';
import { applyFieldErrors, resendSays, signedOutMessage, useCountdown } from '@iace/app-kit';
import { useAuth } from '../../providers/auth';

// Same names the server keys `fieldErrors` by — it validates with the same schemas.
const EMAIL_FIELDS = ['email'] as const;
const CODE_FIELDS = ['code'] as const;
const NOTHING_ON_EXPIRY = () => undefined;

/** Email + OTP. No self-signup: an unknown address simply never receives a code. */
export function LoginPage() {
  const { identity: admin, signIn, signedOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);

  // Where ProtectedRoute turned them away from, so a deep link survives the sign-in.
  const cameFrom = (location.state as { from?: string } | null)?.from ?? ROUTES.HOME;

  if (admin) return <Navigate to={cameFrom} replace />;

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
          <Brandmark size="lg" portal="Admin" className="justify-center px-6 pt-7" />

          {signedOutMessage(signedOutReason) ? (
            <div className="px-6 pt-4">
              <Alert variant="warning">{signedOutMessage(signedOutReason)}</Alert>
            </div>
          ) : null}

          {email === null || challenge === null ? (
            <EmailStep
              onSent={(value, response) => {
                setEmail(value);
                setChallenge(response);
              }}
            />
          ) : (
            <CodeStep
              email={email}
              challenge={challenge}
              onBack={() => {
                setEmail(null);
                setChallenge(null);
              }}
              onResent={setChallenge}
              onVerified={(session) => {
                signIn(session);
                void navigate(cameFrom, { replace: true });
              }}
            />
          )}
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmailStep({
  onSent,
}: Readonly<{ onSent: (email: string, response: OtpRequestResponse) => void }>) {
  const form = useForm({
    resolver: zodResolver(requestAdminOtpSchema),
    defaultValues: { email: '' },
  });

  const requestOtp = useMutation({
    // `fields` keeps the complaint on the input rather than also in a toast.
    meta: { fields: EMAIL_FIELDS },
    mutationFn: (values: { email: string }) => api.auth.requestAdminOtp(values),
    onSuccess: (response, values) => onSent(values.email, response),
    onError: (error) => applyFieldErrors(error, form.setError, EMAIL_FIELDS),
  });

  return (
    <CardStep title="Admin sign in">
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => requestOtp.mutate(values))}
        noValidate
      >
        <Field htmlFor="email" label="Email address" error={form.formState.errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              {...form.register('email')}
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@iace.co.in"
              invalid={Boolean(form.formState.errors.email)}
            />
          )}
        </Field>

        <Button type="submit" loading={requestOtp.isPending}>
          Send code
        </Button>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

function CodeStep({
  email,
  challenge,
  onBack,
  onResent,
  onVerified,
}: Readonly<{
  email: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onResent: (fresh: OtpRequestResponse) => void;
  onVerified: (session: Awaited<ReturnType<typeof api.auth.verifyAdminOtp>>) => void;
}>) {
  const form = useForm({
    resolver: zodResolver(otpCodeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    meta: { fields: CODE_FIELDS },
    mutationFn: (values: { code: string }) => api.auth.verifyAdminOtp({ email, code: values.code }),
    onSuccess: onVerified,
    onError: (error) => applyFieldErrors(error, form.setError, CODE_FIELDS),
  });

  const [wait, setWait] = useState(() => ({ sec: challenge.resendAfterSec, from: Date.now() }));
  const waitSec = useCountdown(
    useCallback(() => Math.max(0, Math.ceil(wait.sec - (Date.now() - wait.from) / 1000)), [wait]),
    NOTHING_ON_EXPIRY,
  );
  const again = useMutation({
    mutationFn: () => api.auth.requestAdminOtp({ email }),
    onSuccess: (fresh) => {
      setWait({ sec: fresh.resendAfterSec, from: Date.now() });
      form.reset();
      onResent(fresh);
    },
  });

  return (
    <CardStep
      title="Enter the code"
      meta={
        <>
          Sent to <span className="font-medium text-foreground">{email}</span>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => verify.mutate(values))}
        noValidate
      >
        <PinField
          name="code"
          form={form}
          label="One-time code"
          // The server decides how long a code is; the boxes follow it rather than assuming six.
          length={challenge.codeLength}
          autoFocus
          autoComplete="one-time-code"
        />

        {challenge.devCode ? (
          <Alert variant="info">
            <Info aria-hidden />
            <span>
              Development sender. Your code is{' '}
              <span className="font-semibold tabular-nums">{challenge.devCode}</span>
            </span>
          </Alert>
        ) : null}

        <Button type="submit" loading={verify.isPending} disabled={again.isPending}>
          Verify &amp; continue
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={waitSec > 0 || verify.isPending}
          loading={again.isPending}
          onClick={() => again.mutate()}
        >
          {resendSays(waitSec, undefined)}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={verify.isPending || again.isPending}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden />
          Use a different email
        </Button>
      </form>
    </CardStep>
  );
}
