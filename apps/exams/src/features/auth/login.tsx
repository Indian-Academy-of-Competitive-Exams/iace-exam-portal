import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import {
  MOBILE_DIGITS,
  PIN_LENGTH,
  normaliseMobile,
  otpCodeFormSchema,
  setPinFormSchema,
  requestStudentOtpSchema,
  studentLoginSchema,
  type AuthSessionResponse,
  type OtpRequestResponse,
  type PinSetupTicket,
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
  OTP_INTENTS,
  signedOutMessage,
  type LoginStep,
  type OtpIntent,
} from '@iace/app-kit';
import { useAuth } from '../../providers/auth';

export function LoginPage() {
  const { identity: student, signIn, signedOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<LoginStep>({ kind: 'signIn' });

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

          {step.kind === 'signIn' ? (
            <SignInStep
              onSignedIn={onSignedIn}
              onSignUp={() => setStep({ kind: 'mobile', intent: OTP_INTENTS.SIGNUP })}
              onForgotPin={() => setStep({ kind: 'mobile', intent: OTP_INTENTS.RESET })}
            />
          ) : null}

          {step.kind === 'mobile' ? (
            <MobileStep
              intent={step.intent}
              onBack={() => setStep({ kind: 'signIn' })}
              onSent={(mobile, challenge) =>
                setStep({ kind: 'code', intent: step.intent, mobile, challenge })
              }
            />
          ) : null}

          {step.kind === 'code' ? (
            <CodeStep
              mobile={step.mobile}
              challenge={step.challenge}
              onBack={() => setStep({ kind: 'mobile', intent: step.intent })}
              onVerified={(ticket) =>
                setStep({ kind: 'pin', intent: step.intent, mobile: step.mobile, ticket })
              }
            />
          ) : null}

          {step.kind === 'pin' ? (
            <SetPinStep mobile={step.mobile} ticket={step.ticket} onSignedIn={onSignedIn} />
          ) : null}
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SignInStep({
  onSignedIn,
  onSignUp,
  onForgotPin,
}: Readonly<{
  onSignedIn: (session: AuthSessionResponse) => void;
  onSignUp: () => void;
  onForgotPin: () => void;
}>) {
  const form = useForm({
    resolver: zodResolver(studentLoginSchema),
    defaultValues: { mobile: '', pin: '' },
  });

  const login = useMutation({
    // `fields` keeps the complaint on the input rather than also in a toast.
    meta: { fields: LOGIN_FIELDS.SIGN_IN },
    mutationFn: (values: { mobile: string; pin: string }) => api.auth.loginStudent(values),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, LOGIN_FIELDS.SIGN_IN),
  });

  return (
    <CardStep title="Sign in">
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => login.mutate(values))}
        noValidate
      >
        <MobileField form={form} name="mobile" autoFocus />
        <PinField
          name="pin"
          form={form}
          label="PIN"
          length={PIN_LENGTH}
          masked
          autoComplete="current-password"
        />

        <Button type="submit" loading={login.isPending}>
          Sign in
        </Button>

        {/* Two peer actions weighted the same: brand red made one outshout the primary button. */}
        <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
          <button
            type="button"
            onClick={onSignUp}
            className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            Create an account
          </button>
          <button
            type="button"
            onClick={onForgotPin}
            className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            Forgot PIN?
          </button>
        </div>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

function MobileStep({
  intent,
  onBack,
  onSent,
}: Readonly<{
  intent: OtpIntent;
  onBack: () => void;
  onSent: (mobile: string, response: OtpRequestResponse) => void;
}>) {
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
    <CardStep
      title={intent === OTP_INTENTS.SIGNUP ? 'Create your account' : 'Reset your PIN'}
      meta={intent === OTP_INTENTS.SIGNUP ? "We'll verify it, then you pick a PIN." : undefined}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => requestOtp.mutate(values))}
        noValidate
      >
        <MobileField form={form} name="mobile" autoFocus />

        <Button type="submit" loading={requestOtp.isPending}>
          Send code
        </Button>

        <BackButton onClick={onBack}>Back to sign in</BackButton>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

function CodeStep({
  mobile,
  challenge,
  onBack,
  onVerified,
}: Readonly<{
  mobile: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onVerified: (ticket: PinSetupTicket) => void;
}>) {
  const form = useForm({
    resolver: zodResolver(otpCodeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    meta: { fields: LOGIN_FIELDS.CODE },
    mutationFn: (values: { code: string }) => api.auth.verifyStudentOtp({ mobile, ...values }),
    onSuccess: onVerified,
    // A wrong code returns OTP_INVALID with fieldErrors.code — it belongs under the input, not a banner.
    onError: (error) => applyFieldErrors(error, form.setError, LOGIN_FIELDS.CODE),
  });

  return (
    <CardStep
      title="Enter the code"
      meta={
        <>
          Sent to <span className="font-medium text-foreground tabular-nums">+91 {mobile}</span>
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

        <Button type="submit" loading={verify.isPending}>
          Verify &amp; continue
        </Button>

        <BackButton onClick={onBack}>Use a different number</BackButton>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------

function SetPinStep({
  mobile,
  ticket,
  onSignedIn,
}: Readonly<{
  mobile: string;
  ticket: PinSetupTicket;
  onSignedIn: (session: AuthSessionResponse) => void;
}>) {
  const form = useForm({
    resolver: zodResolver(setPinFormSchema),
    defaultValues: { pin: '', confirmPin: '' },
  });

  const setPin = useMutation({
    meta: { fields: LOGIN_FIELDS.SET_PIN },
    mutationFn: (values: { pin: string }) =>
      api.auth.setStudentPin({ mobile, setupToken: ticket.setupToken, pin: values.pin }),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, LOGIN_FIELDS.SET_PIN),
  });

  return (
    <CardStep
      title={ticket.pinAlreadySet ? 'Choose a new PIN' : 'Choose your PIN'}
      meta="This is how you sign in from now on. No more codes."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => setPin.mutate(values))}
        noValidate
      >
        <PinField
          name="pin"
          form={form}
          label="New PIN"
          length={PIN_LENGTH}
          masked
          autoFocus
          autoComplete="new-password"
          /* ui-copy-ok: rule */ hint="Not a run like 1234, and not all one digit"
        />
        <PinField
          name="confirmPin"
          form={form}
          label="Confirm PIN"
          length={PIN_LENGTH}
          masked
          autoComplete="new-password"
        />

        <Button type="submit" loading={setPin.isPending}>
          Save PIN &amp; continue
        </Button>
      </form>
    </CardStep>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** The mobile input is identical on both screens that ask for one. */
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
  children,
}: Readonly<{ onClick: () => void; children: React.ReactNode }>) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft aria-hidden />
      {children}
    </Button>
  );
}
