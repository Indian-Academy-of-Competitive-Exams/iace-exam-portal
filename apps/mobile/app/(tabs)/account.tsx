import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { ActiveDevices } from '../../src/components/account/active-devices';
import { Button } from '../../src/components/ui/button';
import { ConfirmDialog } from '../../src/components/ui/confirm-dialog';
import { useAuth } from '../../src/providers/auth';

export default function AccountScreen() {
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <Text className="text-3xl font-bold tracking-tight text-foreground">Account</Text>

      <ActiveDevices />

      <Button variant="outline" onPress={() => setConfirming(true)}>
        Sign out
      </Button>

      <ConfirmDialog
        open={confirming}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Sign out of this phone?"
        description="You will need your mobile number and PIN to sign in again."
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirming(false);
          void signOut();
        }}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}
