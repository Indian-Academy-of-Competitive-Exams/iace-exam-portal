import { useUnstableNativeVariable } from 'nativewind';

/** A design token as a colour for props NativeWind cannot style, such as navigator options. */
export function useTokenColor(token: string): string | undefined {
  const value: unknown = useUnstableNativeVariable(token);
  if (typeof value !== 'string') return undefined;
  // A token forwarding to another (`var(--slate-950)`) cannot be followed here; let the default stand.
  return value.startsWith('var(') ? undefined : value;
}
