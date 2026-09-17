import { type ClientKind } from '@iace/contracts';

/** Why a session ended, when that is worth telling the student: a newer sign-in replaced it. */
export interface SignOutReason {
  replacedBy: ClientKind | null;
}

/**
 * One-way channel from "the refresh token is gone" to "show the login screen".
 * An interface, not a window event: both ends live in the DOM-free tier.
 */
export interface SignOutSignal {
  emit(reason?: SignOutReason): void;
  subscribe(handler: (reason?: SignOutReason) => void): () => void;
}
