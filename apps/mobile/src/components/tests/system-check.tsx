import { ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useUnstableNativeVariable } from 'nativewind';
import { Check, X } from 'lucide-react-native';
import { api } from '../../lib/api';
import { SYSTEM_CHECK_QUERY_KEY } from '../../lib/constants';
import { Alert } from '../ui/alert';

/** Two of the web's three checks: a device has no browser to vet, so only the session proves itself. */
export function SystemCheck() {
  // The session is proven by the call succeeding, which is also the reachability check.
  const reachable = useQuery({
    queryKey: SYSTEM_CHECK_QUERY_KEY,
    queryFn: () => api.auth.me(),
    retry: false,
    staleTime: 0,
  });
  const okColor = useUnstableNativeVariable('--success');
  const failColor = useUnstableNativeVariable('--destructive');

  const checks = [
    { label: 'You are signed in', ok: reachable.isSuccess },
    { label: 'The exam server is reachable', ok: reachable.isSuccess },
  ];
  const failed = checks.some((check) => !check.ok);

  return (
    <View className="gap-3">
      <Text className="text-sm font-semibold tracking-tight text-foreground">System check</Text>

      {reachable.isLoading ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator />
          <Text className="text-sm text-muted-foreground">Checking your connection</Text>
        </View>
      ) : (
        <View className="gap-1.5">
          {checks.map((check) => (
            <CheckRow key={check.label} {...check} okColor={okColor} failColor={failColor} />
          ))}
        </View>
      )}

      {!reachable.isLoading && failed ? (
        <Alert variant="warning">
          Fix this before you begin. The clock does not stop while you sort out your connection.
        </Alert>
      ) : null}
    </View>
  );
}

function CheckRow({
  label,
  ok,
  okColor,
  failColor,
}: Readonly<{ label: string; ok: boolean; okColor: unknown; failColor: unknown }>) {
  const raw = ok ? okColor : failColor;
  const color = typeof raw === 'string' ? raw : undefined;

  return (
    <View className="flex-row items-center gap-2">
      {ok ? <Check size={16} color={color} /> : <X size={16} color={color} />}
      <Text className={ok ? 'text-sm text-foreground' : 'text-sm text-destructive'}>{label}</Text>
    </View>
  );
}
