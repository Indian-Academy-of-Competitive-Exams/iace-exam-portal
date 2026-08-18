import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, Info } from 'lucide-react';
import {
  MOBILE_DIGITS,
  PIN_LENGTH,
  newPinSchema,
  normaliseMobile,
  otpCodeSchema,
  pinSchema,
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  NumericInput,
  PinField,
  ThemeToggle,
  digitsOnly,
} from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors } from '@iace/app-kit';
import { useAuth } from '../providers/auth';
/** Why the student is going through the OTP flow — it only changes the words. */
const OTP_INTENTS = {
  SIGNUP: 'SIGNUP',
  RESET: 'RESET',
} as const;
type OtpIntent = (typeof OTP_INTENTS)[keyof typeof OTP_INTENTS];

// The fields each form owns; the server keys `fieldErrors` by the same names.
const SIGN_IN_FIELDS = ['mobile', 'pin'] as const;
const MOBILE_FIELDS = ['mobile'] as const;
const CODE_FIELDS = ['code'] as const;
const SET_PIN_FIELDS = ['pin', 'confirmPin'] as const;

const STEP_HEADER = 'items-center pt-4 text-center';

/**
 * Mobile + a 4-digit PIN. An OTP appears twice: signup, and recovering a forgotten PIN.
 * Separate buttons rather than a lookup — "does this mobile exist?" is not a question to answer.
 */
type Step =
  | { kind: 'signIn' }
  | { kind: 'mobile'; intent: OtpIntent }
  | { kind: 'code'; intent: OtpIntent; mobile: string; challenge: OtpRequestResponse }
  | { kind: 'pin'; intent: OtpIntent; mobile: string; ticket: PinSetupTicket };

export function LoginPage() {
  const { identity: student, signIn } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'signIn' });

  if (student) return <Navigate to={ROUTES.HOME} replace />;

  const onSignedIn = (session: AuthSessionResponse) => {
    signIn(session);
    void navigate(ROUTES.HOME, { replace: true });
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      {/* pb-24 pulls the card just above the true centre: dead-centre reads as
          low on a tall screen, and this is the only thing on the page. */}
      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
          <Brandmark size="lg" className="justify-center px-6 pt-7" />

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
    meta: { fields: SIGN_IN_FIELDS },
    mutationFn: (values: { mobile: string; pin: string }) => api.auth.loginStudent(values),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, SIGN_IN_FIELDS),
  });

  return (
    <>
      <CardHeader className={STEP_HEADER}>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Your mobile number and your {PIN_LENGTH}-digit PIN.</CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => login.mutate(values))}
          noValidate
        >
          <MobileField autoFocus register={form.register('mobile')} />
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

          {/* Two peer actions, weighted the same. Styling one in brand red made
              it compete with the primary button for the same glance. */}
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
      </CardContent>
    </>
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
    meta: { fields: MOBILE_FIELDS },
    mutationFn: (values: { mobile: string }) => api.auth.requestStudentOtp(values),
    onSuccess: (response, values) => onSent(values.mobile, response),
    onError: (error) => applyFieldErrors(error, form.setError, MOBILE_FIELDS),
  });

  return (
    <>
      <CardHeader className={STEP_HEADER}>
        <CardTitle>
          {intent === OTP_INTENTS.SIGNUP ? 'Create your account' : 'Reset your PIN'}
        </CardTitle>
        <CardDescription>
          {intent === OTP_INTENTS.SIGNUP
            ? "Enter your mobile number. We'll send a one-time code to verify it, then you'll pick a PIN."
            : "Enter your registered mobile number and we'll send a one-time code."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => requestOtp.mutate(values))}
          noValidate
        >
          <MobileField autoFocus register={form.register('mobile')} />

          <Button type="submit" loading={requestOtp.isPending}>
            Send code
          </Button>

          <BackButton onClick={onBack}>Back to sign in</BackButton>
        </form>
      </CardContent>
    </>
  );
}

// ---------------------------------------------------------------------------

const codeFormSchema = z.object({ code: otpCodeSchema });

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
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    meta: { fields: CODE_FIELDS },
    mutationFn: (values: { code: string }) => api.auth.verifyStudentOtp({ mobile, ...values }),
    onSuccess: onVerified,
    // A wrong code comes back as OTP_INVALID with fieldErrors.code — it belongs
    // under the input the student is about to retype, not in a banner.
    onError: (error) => applyFieldErrors(error, form.setError, CODE_FIELDS),
  });

  return (
    <>
      <CardHeader className={STEP_HEADER}>
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

          <BackButton onClick={onBack}>Use a different number</BackButton>
        </form>
      </CardContent>
    </>
  );
}

// ---------------------------------------------------------------------------

const setPinFormSchema = z
  .object({ pin: newPinSchema, confirmPin: pinSchema })
  .refine((values) => values.pin === values.confirmPin, {
    message: 'Both PINs must match',
    path: ['confirmPin'],
  });

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
    meta: { fields: SET_PIN_FIELDS },
    mutationFn: (values: { pin: string }) =>
      api.auth.setStudentPin({ mobile, setupToken: ticket.setupToken, pin: values.pin }),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, SET_PIN_FIELDS),
  });

  return (
    <>
      <CardHeader className={STEP_HEADER}>
        <CardTitle>{ticket.pinAlreadySet ? 'Choose a new PIN' : 'Choose your PIN'}</CardTitle>
        <CardDescription>
          {PIN_LENGTH} digits — this is how you&apos;ll sign in from now on. No more codes.
        </CardDescription>
      </CardHeader>

      <CardContent>
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
            hint={`${PIN_LENGTH} digits — avoid 1234 or all one digit`}
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
      </CardContent>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** The mobile input is identical on three of the four screens. */
function MobileField({
  autoFocus,
  error,
  register,
}: Readonly<{
  autoFocus?: boolean;
  error?: string;
  register: UseFormRegisterReturn;
}>) {
  return (
    <Field
      htmlFor="mobile"
      label="Mobile number"
      error={error}
      hint="The number you signed up with"
    >
      {(control) => (
        <NumericInput
          {...control}
          {...register}
          autoFocus={autoFocus}
          autoComplete="tel"
          // Room for a +91 paste; a flat cap of 10 would keep the wrong ten digits.
          maxLength={15}
          // Digits first, then normalise: the other order lets letters through on paste.
          sanitize={(raw) => normaliseMobile(digitsOnly(raw)).slice(0, MOBILE_DIGITS)}
          placeholder="98765 43210"
          prefix="+91"
          invalid={Boolean(error)}
          className="tabular-nums"
        />
      )}
    </Field>
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
