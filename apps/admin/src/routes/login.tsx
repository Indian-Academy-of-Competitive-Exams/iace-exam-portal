import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { otpCodeSchema, requestAdminOtpSchema, type OtpRequestResponse } from '@iace/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

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
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-foreground">
          IACE <span className="text-muted-foreground">Admin</span>
        </span>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
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
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <Mail className="size-5 text-primary" aria-hidden />
        </div>
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@iace.co.in"
              invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

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
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
        </div>
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium text-foreground">
              One-time code
            </label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="••••••"
              maxLength={8}
              className="tracking-[0.5em] tabular-nums"
              invalid={Boolean(form.formState.errors.code)}
              {...form.register('code')}
            />
            <FieldError message={form.formState.errors.code?.message} />
          </div>

          {challenge.devCode ? (
            <p className="rounded-md bg-info-subtle px-3 py-2 text-xs text-info-ink">
              Development sender: your code is{' '}
              <span className="font-semibold tabular-nums">{challenge.devCode}</span>
            </p>
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

/** Shows only what the field errors did not already say. */
function RequestError({ error, fields }: { error: unknown; fields?: readonly string[] }) {
  const message = bannerMessage(error, fields);
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
