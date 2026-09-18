/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { ActiveDevices } from '../../src/components/account/active-devices';
import { Alert } from '../../src/components/ui/alert';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { ConfirmDialog } from '../../src/components/ui/confirm-dialog';
import { api } from '../../src/lib/api';
import { ACCOUNT_ROUTES } from '../../src/lib/nav';
import { dropPushDevice } from '../../src/lib/push-device';
import { UNREAD_QUERY_KEY } from '../../src/lib/constants';
import { useTokenColor } from '../../src/lib/use-token-color';
import { cn } from '../../src/lib/cn';
import { useAuth } from '../../src/providers/auth';

export default function AccountScreen() {
  const { identity, signOut } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const chevron = useTokenColor('--muted-foreground');

  const unread = useQuery({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => api.me.notifications({ unreadOnly: 'true', pageSize: 1 }),
  });
  const waiting = unread.data?.total ?? 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <View className="gap-1">
        <Text className="text-3xl font-bold tracking-tight text-foreground">Account</Text>
        {identity?.fullName ? (
          <Text className="text-sm text-muted-foreground">{identity.fullName}</Text>
        ) : null}
      </View>

      {identity?.hasDefaultPin ? (
        <Alert variant="warning">
          Your PIN is the one you were given when you were enrolled. Anyone holding the class list
          can work it out — pick your own.
        </Alert>
      ) : null}

      <Card>
        {[
          { label: 'Your details', to: ACCOUNT_ROUTES.PROFILE, badge: undefined },
          {
            label: 'Notifications',
            to: ACCOUNT_ROUTES.NOTIFICATIONS,
            badge: waiting > 0 ? String(waiting) : undefined,
          },
          { label: 'Change your PIN', to: ACCOUNT_ROUTES.CHANGE_PIN, badge: undefined },
        ].map((row, index) => (
          <MenuRow
            key={row.label}
            label={row.label}
            badge={row.badge}
            divided={index > 0}
            tint={chevron}
            onPress={() => router.navigate(row.to)}
          />
        ))}
      </Card>

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
          void dropPushDevice().then(() => signOut());
        }}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

function MenuRow({
  label,
  badge,
  divided,
  onPress,
  tint,
}: Readonly<{
  label: string;
  badge?: string;
  divided: boolean;
  onPress: () => void;
  tint?: string;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn('flex-row items-center gap-3 p-4', divided && 'border-t border-border')}
    >
      <Text className="flex-1 text-base text-foreground">{label}</Text>
      {badge ? <Badge variant="primary">{badge}</Badge> : null}
      <ChevronRight size={18} color={tint} />
    </Pressable>
  );
}
