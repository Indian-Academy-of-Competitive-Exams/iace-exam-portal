import { useUnstableNativeVariable } from 'nativewind';

/** A design token as a colour for props NativeWind cannot style, such as navigator options. */
export function useTokenColor(token: string): string | undefined {
  const value: unknown = useUnstableNativeVariable(token);
  return typeof value === 'string' ? value : undefined;
}
