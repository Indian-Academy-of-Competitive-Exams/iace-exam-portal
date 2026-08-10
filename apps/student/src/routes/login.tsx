import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import {
  ApiError,
  otpCodeSchema,
  requestStudentOtpSchema,
  type OtpRequestResponse,
} from '@iace/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

const codeFormSchema = z.object({ code: otpCodeSchema });

/**
 * Mobile + OTP, in two steps. ThinkExam used email + password; the whole point
 * of the change is that a student only ever needs their phone.
 */
export function LoginPage() {
  const { student, signIn } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);

  if (student) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-foreground">IACE</span>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          {mobile === null || challenge === null ? (
            <MobileStep
              onSent={(value, response) => {
                setMobile(value);
                setChallenge(response);
              }}
            />
          ) : (
            <CodeStep
              mobile={mobile}
              challenge={challenge}
              onBack={() => {
                setMobile(null);
                setChallenge(null);
              }}
              onVerified={(session) => {
                signIn(session);
                void navigate('/', { replace: true });
              }}
            />
          )}
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MobileStep({
  onSent,
}: {
  onSent: (mobile: string, response: OtpRequestResponse) => void;
}) {
  const form = useForm({
    resolver: zodResolver(requestStudentOtpSchema),
    defaultValues: { mobile: '' },
  });

  const requestOtp = useMutation({
    mutationFn: (values: { mobile: string }) => api.auth.requestStudentOtp(values),
    onSuccess: (response, values) => onSent(values.mobile, response),
  });

  return (
    <>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <Smartphone className="size-5 text-primary" aria-hidden />
        </div>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter your mobile number and we&apos;ll send you a one-time code.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => requestOtp.mutate(values))}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mobile" className="text-sm font-medium text-foreground">
              Mobile number
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm tabular-nums text-muted-foreground">+91</span>
              <Input
                id="mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                placeholder="98765 43210"
                maxLength={13}
                invalid={Boolean(form.formState.errors.mobile)}
                {...form.register('mobile')}
              />
            </div>
            <FieldError message={form.formState.errors.mobile?.message} />
          </div>

          <RequestError error={requestOtp.error} />

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
  mobile,
  challenge,
  onBack,
  onVerified,
}: {
  mobile: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onVerified: (session: Awaited<ReturnType<typeof api.auth.verifyStudentOtp>>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    mutationFn: (values: { code: string }) =>
      api.auth.verifyStudentOtp({ mobile, code: values.code }),
    onSuccess: onVerified,
  });

  return (
    <>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
        </div>
        <CardTitle>Enter the code</CardTitle>
        <CardDescription>
          Sent to <span className="font-medium text-foreground tabular-nums">+91 {mobile}</span>
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

          <RequestError error={verify.error} />

          <Button type="submit" disabled={verify.isPending}>
            {verify.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Verify &amp; continue
          </Button>

          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />
            Use a different number
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

function RequestError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
