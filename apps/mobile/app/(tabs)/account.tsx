/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { type LucideIcon } from 'lucide-react-native';
import { Text } from '../../src/components/ui/text';
import { ActiveDevices } from '../../src/components/account/active-devices';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { ChipRow } from '../../src/components/ui/chip-row';
import { ConfirmDialog } from '../../src/components/ui/confirm-dialog';
import { api } from '../../src/lib/api';
import { ACCOUNT_ROUTES } from '../../src/lib/nav';
import { dropPushDevice } from '../../src/lib/push-device';
import { UNREAD_QUERY_KEY } from '../../src/lib/constants';
import { useTokenColor } from '../../src/lib/use-token-color';
import { cn } from '../../src/lib/cn';
import { chooseTheme, savedTheme, THEMES, type Theme } from '../../src/lib/theme';
import { useAuth } from '../../src/providers/auth';
import { useRefetchOnFocus } from '../../src/lib/use-refetch-on-focus';
import LogOut from 'lucide-react-native/icons/log-out';
import UserRound from 'lucide-react-native/icons/user-round';
import Bell from 'lucide-react-native/icons/bell';
import Palette from 'lucide-react-native/icons/palette';
import SmartphoneCharging from 'lucide-react-native/icons/smartphone-charging';
import Sun from 'lucide-react-native/icons/sun';
import Moon from 'lucide-react-native/icons/moon';

export default function AccountScreen() {
  useRefetchOnFocus();
  const { identity, signOut } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const chevron = useTokenColor('--muted-foreground');
  const [theme, setTheme] = useState(savedTheme);

  const unread = useQuery({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => api.me.notifications({ unreadOnly: 'true', pageSize: 1 }),
  });
  const waiting = unread.data?.total ?? 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <View className="gap-1">
        <Text variant="title">Account</Text>
        {identity?.fullName ? <Text variant="muted">{identity.fullName}</Text> : null}
      </View>

      <Card>
        {[
          { label: 'Your details', icon: UserRound, to: ACCOUNT_ROUTES.PROFILE, badge: undefined },
          {
            label: 'Notifications',
            icon: Bell,
            to: ACCOUNT_ROUTES.NOTIFICATIONS,
            badge: waiting > 0 ? String(waiting) : undefined,
          },
        ].map((row, index) => (
          <MenuRow
            key={row.label}
            label={row.label}
            icon={row.icon}
            badge={row.badge}
            divided={index > 0}
            tint={chevron}
            onPress={() => router.navigate(row.to)}
          />
        ))}
      </Card>

      <Card className="p-4">
        <ChipRow
          label="Appearance"
          labelIcon={Palette}
          options={THEME_OPTIONS}
          value={theme}
          onChange={(value) => {
            const next = value as Theme;
            setTheme(next);
            chooseTheme(next);
          }}
        />
      </Card>

      <ActiveDevices />

      <Button variant="outline" icon={LogOut} onPress={() => setConfirming(true)}>
        Sign out
      </Button>

      <ConfirmDialog
        open={confirming}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Sign out of this phone?"
        description="You will need a code sent to your mobile number to sign in again."
        confirmLabel="Sign out"
        icon={LogOut}
        loading={signingOut}
        // Left open and spinning: signing out takes this screen away with it.
        onConfirm={() => {
          setSigningOut(true);
          void dropPushDevice().then(() => signOut());
        }}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

const THEME_OPTIONS = [
  { value: THEMES.SYSTEM, label: 'System', icon: SmartphoneCharging },
  { value: THEMES.LIGHT, label: 'Light', icon: Sun },
  { value: THEMES.DARK, label: 'Dark', icon: Moon },
];

function MenuRow({
  label,
  icon: Icon,
  badge,
  divided,
  onPress,
  tint,
}: Readonly<{
  label: string;
  icon: LucideIcon;
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
      <Icon size={20} color={tint} />
      <Text className="flex-1 text-base text-foreground">{label}</Text>
      {badge ? <Badge variant="primary">{badge}</Badge> : null}
      <ChevronRight size={18} color={tint} />
    </Pressable>
  );
}
