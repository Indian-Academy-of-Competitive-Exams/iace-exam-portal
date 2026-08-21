import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, Info } from 'lucide-react';
import { otpCodeSchema, requestAdminOtpSchema, type OtpRequestResponse } from '@iace/contracts';
import {
  Alert,
  Brandmark,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PinField,
  ThemeToggle,
} from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors } from '@iace/app-kit';
import { useAuth } from '../providers/auth';
const codeFormSchema = z.object({ code: otpCodeSchema });

// Same names the server keys `fieldErrors` by — it validates with the same schemas.
const EMAIL_FIELDS = ['email'] as const;
const CODE_FIELDS = ['code'] as const;

const STEP_HEADER = 'items-center pt-4 text-center';

/** Email + OTP. No self-signup: an unknown address simply never receives a code. */
export function LoginPage() {
  const { identity: admin, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);

  if (admin) return <Navigate to={ROUTES.HOME} replace />;

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
          <Brandmark size="lg" portal="Admin" className="justify-center px-6 pt-7" />

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
              onVerified={(session) => {
                signIn(session);
                void navigate(ROUTES.HOME, { replace: true });
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
    <>
      <CardHeader className={STEP_HEADER}>
        <CardTitle>Admin sign in</CardTitle>
      </CardHeader>

      <CardContent>
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
      </CardContent>
    </>
  );
}

// ---------------------------------------------------------------------------

function CodeStep({
  email,
  challenge,
  onBack,
  onVerified,
}: Readonly<{
  email: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onVerified: (session: Awaited<ReturnType<typeof api.auth.verifyAdminOtp>>) => void;
}>) {
  const form = useForm({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    meta: { fields: CODE_FIELDS },
    mutationFn: (values: { code: string }) => api.auth.verifyAdminOtp({ email, code: values.code }),
    onSuccess: onVerified,
    onError: (error) => applyFieldErrors(error, form.setError, CODE_FIELDS),
  });

  return (
    <>
      <CardHeader className={STEP_HEADER}>
        <CardTitle>Enter the code</CardTitle>
        <CardDescription>
          Sent to <span className="font-medium text-foreground">{email}</span>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => verify.mutate(values))}
          noValidate
        >
          <PinField
            name="code"
            form={form}
            label="One-time code"
            // The server decides how long a code is; the boxes follow it rather
            // than assuming six.
            length={challenge.codeLength}
            autoFocus
            autoComplete="one-time-code"
          />

          {challenge.devCode ? (
            <Alert variant="info">
              <Info aria-hidden />
              <span>
                Development sender — your code is{' '}
                <span className="font-semibold tabular-nums">{challenge.devCode}</span>
              </span>
            </Alert>
          ) : null}

          <Button type="submit" loading={verify.isPending}>
            Verify &amp; continue
          </Button>

          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />
            Use a different email
          </Button>
        </form>
      </CardContent>
    </>
  );
}
