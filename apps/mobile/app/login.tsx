import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
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
  type RequestStudentOtpBody,
  type StudentLoginBody,
} from '@iace/contracts';
import { applyFieldErrors, signedOutMessage } from '@iace/app-kit';
import { api } from '../src/lib/api';
import { useAuth } from '../src/providers/auth';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { PinField } from '../src/components/ui/pin-field';
import { TextField } from '../src/components/ui/text-field';

/** Why the student is going through the OTP flow — it only changes the words. */
const OTP_INTENTS = { SIGNUP: 'SIGNUP', RESET: 'RESET' } as const;
type OtpIntent = (typeof OTP_INTENTS)[keyof typeof OTP_INTENTS];

// The fields each form owns; the server keys `fieldErrors` by the same names.
const SIGN_IN_FIELDS = ['mobile', 'pin'] as const;
const MOBILE_FIELDS = ['mobile'] as const;
const CODE_FIELDS = ['code'] as const;
const SET_PIN_FIELDS = ['pin', 'confirmPin'] as const;

/** Mobile + a 4-digit PIN; an OTP appears twice, for signup and for a forgotten PIN. */
type Step =
  | { kind: 'signIn' }
  | { kind: 'mobile'; intent: OtpIntent }
  | { kind: 'code'; intent: OtpIntent; mobile: string; challenge: OtpRequestResponse }
  | { kind: 'pin'; intent: OtpIntent; mobile: string; ticket: PinSetupTicket };

const sanitizeMobile = (raw: string) =>
  normaliseMobile(raw.replace(/\D/g, '')).slice(0, MOBILE_DIGITS);

export default function LoginScreen() {
  const { signIn, signedOutReason } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'signIn' });
  const message = signedOutMessage(signedOutReason);

  const onSignedIn = (session: AuthSessionResponse) => signIn(session);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerClassName="flex-1 items-center justify-center px-5 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="w-full max-w-[26rem] gap-6 p-6">
          <View className="items-center">
            <Text className="rounded-md bg-primary px-4 py-1.5 text-2xl font-extrabold tracking-tight text-primary-foreground">
              IACE
            </Text>
          </View>

          {message ? <Alert variant="warning">{message}</Alert> : null}

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
      </ScrollView>
    </KeyboardAvoidingView>
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
    // Explicit type argument: this app's own react-hook-form copy is a separate install from app-kit's.
    onError: (error) => applyFieldErrors<StudentLoginBody>(error, form.setError, SIGN_IN_FIELDS),
  });

  return (
    <View className="gap-4">
      <Text className="text-center text-lg font-semibold text-foreground">Sign in</Text>

      <TextField
        control={form.control}
        name="mobile"
        label="Mobile number"
        keyboardType="number-pad"
        autoComplete="tel"
        maxLength={15}
        sanitize={sanitizeMobile}
        autoFocus
      />
      <PinField control={form.control} name="pin" label="PIN" length={PIN_LENGTH} masked />

      <Button
        loading={login.isPending}
        onPress={form.handleSubmit((values) => login.mutate(values))}
      >
        Sign in
      </Button>

      {/* Two peer actions, weighted the same — neither reads as more important than the other. */}
      <View className="flex-row items-center justify-between border-t border-border pt-4">
        <Pressable onPress={onSignUp}>
          <Text className="text-sm font-medium text-foreground">Create an account</Text>
        </Pressable>
        <Pressable onPress={onForgotPin}>
          <Text className="text-sm text-muted-foreground">Forgot PIN?</Text>
        </Pressable>
      </View>
    </View>
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
    onError: (error) =>
      applyFieldErrors<RequestStudentOtpBody>(error, form.setError, MOBILE_FIELDS),
  });

  return (
    <View className="gap-4">
      <Text className="text-center text-lg font-semibold text-foreground">
        {intent === OTP_INTENTS.SIGNUP ? 'Create your account' : 'Reset your PIN'}
      </Text>

      <TextField
        control={form.control}
        name="mobile"
        label="Mobile number"
        keyboardType="number-pad"
        autoComplete="tel"
        maxLength={15}
        sanitize={sanitizeMobile}
        autoFocus
      />

      <Button
        loading={requestOtp.isPending}
        onPress={form.handleSubmit((values) => requestOtp.mutate(values))}
      >
        Send code
      </Button>

      <BackButton onPress={onBack}>Back to sign in</BackButton>
    </View>
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
    // A wrong code comes back as OTP_INVALID with fieldErrors.code, under the input to retype.
    onError: (error) => applyFieldErrors<{ code: string }>(error, form.setError, CODE_FIELDS),
  });

  return (
    <View className="gap-4">
      <Text className="text-center text-lg font-semibold text-foreground">Enter the code</Text>
      <Text className="text-center text-sm text-muted-foreground">Sent to +91 {mobile}</Text>

      <PinField
        control={form.control}
        name="code"
        label="One-time code"
        // The server decides how long a code is; the field follows it rather than assuming six.
        length={challenge.codeLength}
        autoFocus
      />

      {challenge.devCode ? (
        <Alert>Development sender. Your code is {challenge.devCode}</Alert>
      ) : null}

      <Button
        loading={verify.isPending}
        onPress={form.handleSubmit((values) => verify.mutate(values))}
      >
        Verify &amp; continue
      </Button>

      <BackButton onPress={onBack}>Use a different number</BackButton>
    </View>
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
    onError: (error) =>
      applyFieldErrors<{ pin: string; confirmPin: string }>(error, form.setError, SET_PIN_FIELDS),
  });

  return (
    <View className="gap-4">
      <Text className="text-center text-lg font-semibold text-foreground">
        {ticket.pinAlreadySet ? 'Choose a new PIN' : 'Choose your PIN'}
      </Text>

      <PinField
        control={form.control}
        name="pin"
        label="New PIN"
        length={PIN_LENGTH}
        masked
        autoFocus
        /* ui-copy-ok: rule */ hint="Not a run like 1234, and not all one digit"
      />
      <PinField
        control={form.control}
        name="confirmPin"
        label="Confirm PIN"
        length={PIN_LENGTH}
        masked
      />

      <Button
        loading={setPin.isPending}
        onPress={form.handleSubmit((values) => setPin.mutate(values))}
      >
        Save PIN &amp; continue
      </Button>
    </View>
  );
}

// ---------------------------------------------------------------------------

function BackButton({ onPress, children }: Readonly<{ onPress: () => void; children: string }>) {
  return (
    <Button variant="ghost" size="sm" onPress={onPress}>
      {children}
    </Button>
  );
}
