import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  MOBILE_DIGITS,
  normaliseMobile,
  otpCodeFormSchema,
  requestStudentOtpSchema,
  type AuthSessionResponse,
  type OtpRequestResponse,
  type RequestStudentOtpBody,
} from '@iace/contracts';
import { applyFieldErrors, LOGIN_FIELDS, signedOutMessage, type LoginStep } from '@iace/app-kit';
import { Text } from '../src/components/ui/text';
import { api } from '../src/lib/api';
import { useAuth } from '../src/providers/auth';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { PinField } from '../src/components/ui/pin-field';
import { TextField } from '../src/components/ui/text-field';

const sanitizeMobile = (raw: string) =>
  normaliseMobile(raw.replace(/\D/g, '')).slice(0, MOBILE_DIGITS);

export default function LoginScreen() {
  const { signIn, signedOutReason } = useAuth();
  const [step, setStep] = useState<LoginStep>({ kind: 'mobile' });
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

          {step.kind === 'mobile' ? (
            <MobileStep
              onSent={(mobile, challenge) => setStep({ kind: 'code', mobile, challenge })}
            />
          ) : (
            <CodeStep
              mobile={step.mobile}
              challenge={step.challenge}
              onBack={() => setStep({ kind: 'mobile' })}
              onSignedIn={onSignedIn}
            />
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
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
    onError: (error) =>
      applyFieldErrors<RequestStudentOtpBody>(error, form.setError, LOGIN_FIELDS.MOBILE),
  });

  return (
    <View className="gap-4">
      <Text variant="section" className="text-center">
        Sign in
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
    </View>
  );
}

// ---------------------------------------------------------------------------

function CodeStep({
  mobile,
  challenge,
  onBack,
  onSignedIn,
}: Readonly<{
  mobile: string;
  challenge: OtpRequestResponse;
  onBack: () => void;
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
    // A wrong code comes back as OTP_INVALID with fieldErrors.code, under the input to retype.
    onError: (error) => applyFieldErrors<{ code: string }>(error, form.setError, LOGIN_FIELDS.CODE),
  });

  return (
    <View className="gap-4">
      <Text variant="section" className="text-center">
        Enter the code
      </Text>
      <Text variant="muted" className="text-center">
        Sent to +91 {mobile}
      </Text>

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
        Sign in
      </Button>

      <BackButton onPress={onBack}>Use a different number</BackButton>
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
