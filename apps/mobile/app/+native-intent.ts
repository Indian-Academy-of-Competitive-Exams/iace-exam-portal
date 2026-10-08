import { linkGuard } from '../src/lib/link-guard';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  return linkGuard.admit(path);
}
