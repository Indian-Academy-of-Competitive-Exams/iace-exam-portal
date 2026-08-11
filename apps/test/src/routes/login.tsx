import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import {
  newPinSchema,
  otpCodeSchema,
  pinSchema,
  requestStudentOtpSchema,
  studentLoginSchema,
  type AuthSessionResponse,
  type OtpRequestResponse,
  type PinSetupTicket,
} from '@iace/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@iace/ui';
import { api } from '../lib/api';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from '../components/theme-toggle';

/** Why the student is going through the OTP flow — it only changes the words. */
type OtpIntent = 'SIGNUP' | 'RESET';

// The fields each form owns. The server keys `fieldErrors` by the same names
// (it validates with the same schemas), so a message lands on the input that
// caused it; anything keyed otherwise falls back to the banner.
const SIGN_IN_FIELDS = ['mobile', 'pin'] as const;
const MOBILE_FIELDS = ['mobile'] as const;
const CODE_FIELDS = ['code'] as const;
const SET_PIN_FIELDS = ['pin', 'confirmPin'] as const;

/**
 * Signing in is mobile + a 6-digit PIN. An OTP appears exactly twice: creating
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

  if (student) return <Navigate to="/" replace />;

  const onSignedIn = (session: AuthSessionResponse) => {
    signIn(session);
    void navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-foreground">IACE</span>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          {step.kind === 'signIn' ? (
            <SignInStep
              onSignedIn={onSignedIn}
              onSignUp={() => setStep({ kind: 'mobile', intent: 'SIGNUP' })}
              onForgotPin={() => setStep({ kind: 'mobile', intent: 'RESET' })}
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
        <IconBadge>
          <KeyRound className="size-5 text-primary" aria-hidden />
        </IconBadge>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Your mobile number and your 6-digit PIN.</CardDescription>
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

          <div className="flex items-center justify-between pt-1 text-sm">
            <button
              type="button"
              onClick={onSignUp}
              className="font-medium text-primary hover:underline"
            >
              Create an account
            </button>
            <button
              type="button"
              onClick={onForgotPin}
              className="text-muted-foreground hover:text-foreground hover:underline"
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
        <IconBadge>
          <Smartphone className="size-5 text-primary" aria-hidden />
        </IconBadge>
        <CardTitle>{intent === 'SIGNUP' ? 'Create your account' : 'Reset your PIN'}</CardTitle>
        <CardDescription>
          {intent === 'SIGNUP'
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
        <IconBadge>
          <ShieldCheck className="size-5 text-primary" aria-hidden />
        </IconBadge>
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
        <IconBadge>
          <KeyRound className="size-5 text-primary" aria-hidden />
        </IconBadge>
        <CardTitle>{ticket.pinAlreadySet ? 'Choose a new PIN' : 'Choose your PIN'}</CardTitle>
        <CardDescription>
          Six digits — this is how you&apos;ll sign in from now on. No more codes.
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

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
      {children}
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
          autoFocus={autoFocus}
          placeholder="98765 43210"
          maxLength={13}
          invalid={Boolean(error)}
          {...register}
        />
      </div>
      <FieldError message={error} />
    </div>
  );
}

function PinField({
  id,
  label,
  autoFocus,
  autoComplete = 'new-password',
  error,
  register,
}: {
  id: string;
  label: string;
  autoFocus?: boolean;
  autoComplete?: 'new-password' | 'current-password';
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder="••••••"
        maxLength={6}
        className="tracking-[0.5em] tabular-nums"
        invalid={Boolean(error)}
        {...register}
      />
      <FieldError message={error} />
    </div>
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
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
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
