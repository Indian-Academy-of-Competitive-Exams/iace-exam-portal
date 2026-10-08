import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import {
  MOBILE_DIGITS,
  normaliseMobile,
  otpCodeFormSchema,
  requestStudentOtpSchema,
  type AuthSessionResponse,
  type OtpRequestResponse,
} from '@iace/contracts';
import {
  Alert,
  Brandmark,
  Button,
  Card,
  CardStep,
  FormField,
  NumericInput,
  PinField,
  ThemeToggle,
  digitsOnly,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ROUTES } from '../../lib/constants';
import {
  applyFieldErrors,
  LOGIN_FIELDS,
  sentSays,
  signedOutMessage,
  useResendCode,
  type LoginStep,
} from '@iace/app-kit';
import { useAuth } from '../../providers/auth';

export function LoginPage() {
  const { identity: student, signIn, signedOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<LoginStep>({ kind: 'mobile' });

  // Where ProtectedRoute turned them away from, so a deep link survives the sign-in.
  const cameFrom = (location.state as { from?: string } | null)?.from ?? ROUTES.HOME;

  if (student) return <Navigate to={cameFrom} replace />;

  const onSignedIn = (session: AuthSessionResponse) => {
    signIn(session);
    void navigate(cameFrom, { replace: true });
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      {/* pb-24 pulls the card just above the true centre: dead-centre reads as
          low on a tall screen, and this is the only thing on the page. */}
      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
          <Brandmark size="lg" className="justify-center px-6 pt-7" />

          {signedOutMessage(signedOutReason) ? (
            <div className="px-6 pt-4">
              <Alert variant="warning">{signedOutMessage(signedOutReason)}</Alert>
            </div>
          ) : null}

          {step.kind === 'mobile' ? (
            <MobileStep
              onSent={(mobile, challenge) => setStep({ kind: 'code', mobile, challenge })}
            />
          ) : (
            <CodeStep
              mobile={step.mobile}
              challenge={step.challenge}
              onBack={() => setStep({ kind: 'mobile' })}
              onResent={(challenge) => setStep({ kind: 'code', mobile: step.mobile, challenge })}
              onSignedIn={onSignedIn}
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
}: Readonly<{ onSent: (mobile: string, response: OtpRequestResponse) => void }>) {
  const form = useForm({
    resolver: zodResolver(requestStudentOtpSchema),
    defaultValues: { mobile: '' },
  });

  const requestOtp = useMutation({
    meta: { fields: LOGIN_FIELDS.MOBILE },
    mutationFn: (values: { mobile: string }) => api.auth.requestStudentOtp(values),
    onSuccess: (response, values) => onSent(values.mobile, response),
    onError: (error) => applyFieldErrors(error, form.setError, LOGIN_FIELDS.MOBILE),
  });

  return (
    <CardStep title="Sign in">
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => requestOtp.mutate(values))}
        noValidate
      >
        <MobileField form={form} name="mobile" autoFocus />

        <Button type="submit" loading={requestOtp.isPending}>
          Send code
        </Button>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

function CodeStep({
  mobile,
  challenge,
  onBack,
  onResent,
  onSignedIn,
}: Readonly<{
  mobile: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onResent: (challenge: OtpRequestResponse) => void;
  onSignedIn: (session: AuthSessionResponse) => void;
}>) {
  const form = useForm({
    resolver: zodResolver(otpCodeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    meta: { fields: LOGIN_FIELDS.CODE },
    mutationFn: (values: { code: string }) => api.auth.verifyStudentOtp({ mobile, ...values }),
    onSuccess: onSignedIn,
    // A wrong code returns OTP_INVALID with fieldErrors.code — it belongs under the input, not a banner.
    onError: (error) => applyFieldErrors(error, form.setError, LOGIN_FIELDS.CODE),
  });

  const again = useResendCode(api, mobile, challenge, (fresh) => {
    // The code typed so far belongs to the one this replaces.
    form.reset();
    onResent(fresh);
  });

  return (
    <CardStep title="Enter the code" meta={sentSays(challenge, mobile)}>
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

        {/* One request at a time: an answer to one the student moved on from would still sign in, or pull the step back. */}
        <Button type="submit" loading={verify.isPending} disabled={again.isPending}>
          Sign in
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!again.canResend || verify.isPending}
          loading={again.isPending}
          onClick={again.resend}
        >
          {again.label}
        </Button>

        <BackButton disabled={verify.isPending || again.isPending} onClick={onBack}>
          Use a different number
        </BackButton>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function MobileField<TValues extends FieldValues>({
  form,
  name,
  autoFocus,
}: Readonly<{
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  autoFocus?: boolean;
}>) {
  return (
    <FormField form={form} name={name} label="Mobile number">
      {(control) => (
        <NumericInput
          {...control}
          autoFocus={autoFocus}
          autoComplete="tel"
          // Room for a +91 paste; a flat cap of 10 would keep the wrong ten digits.
          maxLength={15}
          // Digits first, then normalise: the other order lets letters through on paste.
          sanitize={(raw) => normaliseMobile(digitsOnly(raw)).slice(0, MOBILE_DIGITS)}
          placeholder="98765 43210"
          prefix="+91"
          invalid={Boolean(control['aria-invalid'])}
          className="tabular-nums"
        />
      )}
    </FormField>
  );
}

function BackButton({
  onClick,
  disabled,
  children,
}: Readonly<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }>) {
  return (
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClick}>
      <ArrowLeft aria-hidden />
      {children}
    </Button>
  );
}
