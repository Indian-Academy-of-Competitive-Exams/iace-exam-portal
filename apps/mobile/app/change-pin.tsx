/// <reference types="nativewind/types" />
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { applyFieldErrors } from '@iace/app-kit';
import { changePinSchema, PIN_LENGTH, type ChangePinBody } from '@iace/contracts';
import { api } from '../src/lib/api';
import { ACTIVE_DEVICES_QUERY_KEY } from '../src/lib/constants';
import { useAuth } from '../src/providers/auth';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { PinField } from '../src/components/ui/pin-field';

const FORM_FIELDS = ['currentPin', 'newPin'] as const;

/** Also where a student still on the PIN they were given comes to choose their own. */
export default function ChangePinScreen() {
  const { identity, signIn } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const onDefaultPin = identity?.hasDefaultPin ?? false;

  const form = useForm({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPin: '', newPin: '' },
  });

  const change = useMutation({
    mutationFn: (values: ChangePinBody) => api.me.changePin(values),
    onSuccess: (session) => {
      form.reset();
      // Not optional: the change revoked every session opened with the old PIN, including this one.
      signIn(session);
      void queryClient.invalidateQueries({ queryKey: ACTIVE_DEVICES_QUERY_KEY });
      router.back();
    },
    // Explicit type argument: this app's own react-hook-form copy is a separate install from app-kit's.
    onError: (error) => applyFieldErrors<ChangePinBody>(error, form.setError, FORM_FIELDS),
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-5 px-5 py-6" keyboardShouldPersistTaps="handled">
        {/* Said plainly: "for your security" tells a student nothing they can act on. */}
        <Alert variant={onDefaultPin ? 'warning' : 'info'}>
          {onDefaultPin
            ? `Your PIN is the first ${PIN_LENGTH} digits of your mobile number, set for you when you were enrolled. Anyone holding the class list can work it out. Pick your own.`
            : `Any ${PIN_LENGTH} digits. Changing it signs you out everywhere else.`}
        </Alert>

        <Text className="text-lg font-semibold text-foreground">
          {onDefaultPin ? 'Choose your own PIN' : 'Change your PIN'}
        </Text>

        <PinField
          control={form.control}
          name="currentPin"
          label={onDefaultPin ? 'PIN you were given' : 'Current PIN'}
          length={PIN_LENGTH}
          masked
          // ui-copy-ok: format — where the given PIN comes from is not on the screen
          hint={onDefaultPin ? 'The first four digits of your mobile number.' : undefined}
        />

        <PinField
          control={form.control}
          name="newPin"
          label={`New PIN (${PIN_LENGTH} digits)`}
          length={PIN_LENGTH}
          masked
        />

        <View>
          <Button
            loading={change.isPending}
            onPress={form.handleSubmit((values) => change.mutate(values))}
          >
            Save new PIN
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
