import {
  AppException,
  CLIENT_KINDS,
  ErrorCodes,
  clientKindSchema,
  type ClientKind,
} from '@iace/contracts';
import { type SignOutReason } from './sign-out-signal';

const WHERE: Record<ClientKind, string> = {
  [CLIENT_KINDS.WEB]: 'another browser',
  [CLIENT_KINDS.MOBILE]: 'another phone',
};

/** A replacement's reason, read from the error; anything else ends a session without one. */
export function signOutReasonOf(cause: unknown): SignOutReason | undefined {
  if (!AppException.is(cause) || cause.code !== ErrorCodes.SESSION_REPLACED) return undefined;
  const replacedBy = (cause.details as { replacedBy?: unknown } | undefined)?.replacedBy;
  return { replacedBy: clientKindSchema.safeParse(replacedBy).data ?? null };
}

/** What a replaced device tells its student; null when the session ended any other way. */
export function signedOutMessage(reason: SignOutReason | null): string | null {
  if (!reason) return null;
  const where = reason.replacedBy ? WHERE[reason.replacedBy] : 'another device';
  return `You were signed out because this account signed in on ${where}.`;
}
