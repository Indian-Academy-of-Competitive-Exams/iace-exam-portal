import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, Info, Loader2, Mail, ShieldCheck, TriangleAlert } from 'lucide-react';
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
  NumericInput,
} from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '@iace/ui';

const codeFormSchema = z.object({ code: otpCodeSchema });

// Same names the server keys `fieldErrors` by — it validates with the same schemas.
const EMAIL_FIELDS = ['email'] as const;
const CODE_FIELDS = ['code'] as const;

/**
 * Email + OTP. There is no admin self-signup — the account must already exist
 * and be active, so an unknown address simply never receives a code.
 */
export function LoginPage() {
  const { admin, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);

  if (admin) return <Navigate to={ROUTES.HOME} replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
        <div className="flex items-baseline gap-2">
          <Brandmark withWordmark />
          <span className="text-sm font-medium text-muted-foreground">Admin</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
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

function EmailStep({ onSent }: { onSent: (email: string, response: OtpRequestResponse) => void }) {
  const form = useForm({
    resolver: zodResolver(requestAdminOtpSchema),
    defaultValues: { email: '' },
  });

  const requestOtp = useMutation({
    mutationFn: (values: { email: string }) => api.auth.requestAdminOtp(values),
    onSuccess: (response, values) => onSent(values.email, response),
    onError: (error) => applyFieldErrors(error, form.setError, EMAIL_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={Mail} />
        <CardTitle>Admin sign in</CardTitle>
        <CardDescription>
          Enter your work email and we&apos;ll send you a one-time code.
        </CardDescription>
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

          <RequestError error={requestOtp.error} fields={EMAIL_FIELDS} />

          <Button type="submit" disabled={requestOtp.isPending}>
            {requestOtp.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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
}: {
  email: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onVerified: (session: Awaited<ReturnType<typeof api.auth.verifyAdminOtp>>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    mutationFn: (values: { code: string }) => api.auth.verifyAdminOtp({ email, code: values.code }),
    onSuccess: onVerified,
    onError: (error) => applyFieldErrors(error, form.setError, CODE_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={ShieldCheck} />
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
          <Field htmlFor="code" label="One-time code" error={form.formState.errors.code?.message}>
            {(control) => (
              <NumericInput
                {...control}
                {...form.register('code')}
                autoFocus
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="••••••"
                invalid={Boolean(form.formState.errors.code)}
                className="text-center text-base tracking-[0.5em] tabular-nums"
              />
            )}
          </Field>

          {challenge.devCode ? (
            <Alert variant="info">
              <Info aria-hidden />
              <span>
                Development sender — your code is{' '}
                <span className="font-semibold tabular-nums">{challenge.devCode}</span>
              </span>
            </Alert>
          ) : null}

          <RequestError error={verify.error} fields={CODE_FIELDS} />

          <Button type="submit" disabled={verify.isPending}>
            {verify.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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

// ---------------------------------------------------------------------------

/** Brand-tinted accent, matching the test app. */
function StepIcon({ icon: Icon }: { icon: typeof Mail }) {
  return (
    <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
      <Icon className="size-5 text-primary" aria-hidden />
    </div>
  );
}

/** Shows only what the field errors did not already say. */
function RequestError({ error, fields }: { error: unknown; fields?: readonly string[] }) {
  const message = bannerMessage(error, fields);
  if (!message) return null;
  return (
    <Alert variant="danger">
      <TriangleAlert aria-hidden />
      <span>{message}</span>
    </Alert>
  );
}
