import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  ArrowLeft,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
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
  digitsOnly,
} from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

/** Why the student is going through the OTP flow — it only changes the words. */
const OTP_INTENTS = {
  SIGNUP: 'SIGNUP',
  RESET: 'RESET',
} as const;
type OtpIntent = (typeof OTP_INTENTS)[keyof typeof OTP_INTENTS];

// The fields each form owns. The server keys `fieldErrors` by the same names
// (it validates with the same schemas), so a message lands on the input that
// caused it; anything keyed otherwise falls back to the banner.
const SIGN_IN_FIELDS = ['mobile', 'pin'] as const;
const MOBILE_FIELDS = ['mobile'] as const;
const CODE_FIELDS = ['code'] as const;
const SET_PIN_FIELDS = ['pin', 'confirmPin'] as const;

/**
 * Signing in is mobile + a 4-digit PIN. An OTP appears exactly twice: creating
 * the account, and recovering a forgotten PIN — both of which land on the same
 * three screens (mobile → code → choose a PIN).
 *
 * Signup and reset are separate buttons rather than a lookup on the number:
 * asking the server "does this mobile exist?" would answer that question for
 * anyone who asked.
 */
type Step =
  | { kind: 'signIn' }
  | { kind: 'mobile'; intent: OtpIntent }
  | { kind: 'code'; intent: OtpIntent; mobile: string; challenge: OtpRequestResponse }
  | { kind: 'pin'; intent: OtpIntent; mobile: string; ticket: PinSetupTicket };

export function LoginPage() {
  const { student, signIn } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'signIn' });

  if (student) return <Navigate to={ROUTES.HOME} replace />;

  const onSignedIn = (session: AuthSessionResponse) => {
    signIn(session);
    void navigate(ROUTES.HOME, { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
        <Brandmark withWordmark />
        <ThemeToggle />
      </header>

      {/* pb-24 pulls the card just above the true centre: dead-centre reads as
          low on a tall screen, and this is the only thing on the page. */}
      <main className="flex flex-1 items-center justify-center px-5 pb-24">
        <Card className="w-full max-w-[26rem] shadow-md">
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
}: {
  onSignedIn: (session: AuthSessionResponse) => void;
  onSignUp: () => void;
  onForgotPin: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(studentLoginSchema),
    defaultValues: { mobile: '', pin: '' },
  });

  const login = useMutation({
    mutationFn: (values: { mobile: string; pin: string }) => api.auth.loginStudent(values),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, SIGN_IN_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={KeyRound} />
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Your mobile number and your {PIN_LENGTH}-digit PIN.</CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => login.mutate(values))}
          noValidate
        >
          <MobileField
            autoFocus
            error={form.formState.errors.mobile?.message}
            register={form.register('mobile')}
          />
          <PinField
            id="pin"
            label="PIN"
            autoComplete="current-password"
            error={form.formState.errors.pin?.message}
            register={form.register('pin')}
          />

          <RequestError error={login.error} fields={SIGN_IN_FIELDS} />

          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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
}: {
  intent: OtpIntent;
  onBack: () => void;
  onSent: (mobile: string, response: OtpRequestResponse) => void;
}) {
  const form = useForm({
    resolver: zodResolver(requestStudentOtpSchema),
    defaultValues: { mobile: '' },
  });

  const requestOtp = useMutation({
    mutationFn: (values: { mobile: string }) => api.auth.requestStudentOtp(values),
    onSuccess: (response, values) => onSent(values.mobile, response),
    onError: (error) => applyFieldErrors(error, form.setError, MOBILE_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={Smartphone} />
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
          <MobileField
            autoFocus
            error={form.formState.errors.mobile?.message}
            register={form.register('mobile')}
          />

          <RequestError error={requestOtp.error} fields={MOBILE_FIELDS} />

          <Button type="submit" disabled={requestOtp.isPending}>
            {requestOtp.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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
}: {
  mobile: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
  onVerified: (ticket: PinSetupTicket) => void;
}) {
  const form = useForm({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const verify = useMutation({
    mutationFn: (values: { code: string }) => api.auth.verifyStudentOtp({ mobile, ...values }),
    onSuccess: onVerified,
    // A wrong code comes back as OTP_INVALID with fieldErrors.code — it belongs
    // under the input the student is about to retype, not in a banner.
    onError: (error) => applyFieldErrors(error, form.setError, CODE_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={ShieldCheck} />
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
          <CodeField error={form.formState.errors.code?.message} register={form.register('code')} />

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
}: {
  mobile: string;
  ticket: PinSetupTicket;
  onSignedIn: (session: AuthSessionResponse) => void;
}) {
  const form = useForm({
    resolver: zodResolver(setPinFormSchema),
    defaultValues: { pin: '', confirmPin: '' },
  });

  const setPin = useMutation({
    mutationFn: (values: { pin: string }) =>
      api.auth.setStudentPin({ mobile, setupToken: ticket.setupToken, pin: values.pin }),
    onSuccess: onSignedIn,
    onError: (error) => applyFieldErrors(error, form.setError, SET_PIN_FIELDS),
  });

  return (
    <>
      <CardHeader>
        <StepIcon icon={KeyRound} />
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
            id="pin"
            label="New PIN"
            autoFocus
            hint={`${PIN_LENGTH} digits — avoid 1234 or all one digit`}
            error={form.formState.errors.pin?.message}
            register={form.register('pin')}
          />
          <PinField
            id="confirmPin"
            label="Confirm PIN"
            error={form.formState.errors.confirmPin?.message}
            register={form.register('confirmPin')}
          />

          <RequestError error={setPin.error} fields={SET_PIN_FIELDS} />

          <Button type="submit" disabled={setPin.isPending}>
            {setPin.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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

/**
 * The step's icon. Brand-tinted rather than the muted grey square it was — at
 * 10% the tint reads as an accent, not as a filled state, and it gives each
 * card a focal point instead of opening on a bare heading.
 */
function StepIcon({ icon: Icon }: { icon: typeof KeyRound }) {
  return (
    <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
      <Icon className="size-5 text-primary" aria-hidden />
    </div>
  );
}

/** The mobile input is identical on three of the four screens. */
function MobileField({
  autoFocus,
  error,
  register,
}: {
  autoFocus?: boolean;
  error?: string;
  register: UseFormRegisterReturn;
}) {
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
          // Room to paste a +91-prefixed number; normaliseMobile trims it back
          // to the ten digits we store. A flat cap of 10 would truncate the
          // paste first and silently keep the WRONG ten digits.
          maxLength={15}
          // digits first, THEN normalise: normaliseMobile only strips
          // separators and a country code, so composing the other way round
          // let letters straight through on paste.
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

function PinField({
  id,
  label,
  autoFocus,
  autoComplete = 'new-password',
  hint,
  error,
  register,
}: {
  id: string;
  label: string;
  autoFocus?: boolean;
  autoComplete?: 'new-password' | 'current-password';
  hint?: string;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <Field htmlFor={id} label={label} hint={hint} error={error}>
      {(control) => (
        <NumericInput
          {...control}
          {...register}
          masked
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          maxLength={PIN_LENGTH}
          placeholder={'\u2022'.repeat(PIN_LENGTH)}
          invalid={Boolean(error)}
          className="tracking-[0.6em] tabular-nums"
        />
      )}
    </Field>
  );
}

function CodeField({ error, register }: { error?: string; register: UseFormRegisterReturn }) {
  return (
    <Field htmlFor="code" label="One-time code" error={error}>
      {(control) => (
        <NumericInput
          {...control}
          {...register}
          autoFocus
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="••••••"
          invalid={Boolean(error)}
          className="text-center text-base tracking-[0.5em] tabular-nums"
        />
      )}
    </Field>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft aria-hidden />
      {children}
    </Button>
  );
}

/**
 * Shows what the field errors did not already say. When the server's whole
 * complaint has been placed on the inputs, the banner stays out of the way.
 */
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
