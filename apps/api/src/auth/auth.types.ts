import { type ClientKind } from '@iace/contracts';

/** Auth's own internal shapes. */

/** The Redis-resident half of a session. Never written to Postgres. */
export interface StoredSession {
  refreshTokenHash: string;
  /** Minted by a retry of the token before this one, and good until the next rotation, since a tab may have stored it. */
  siblingRefreshTokenHashes?: string[];
  /** What the last rotation consumed, and when: presented again inside the grace window it is a retry, not a replay. */
  previousRefreshTokenHash?: string;
  rotatedAt?: string;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Which app opened it; null for a session from before the one-per-kind rule. */
  client: ClientKind | null;
}

/** A session with the id it lives under, as returned to a subject listing their own. */
export type ListedSession = StoredSession & { id: string };

/** The Redis-resident half of a pending OTP. The code itself is never stored; attempts count in their own atomic key. */
export interface StoredOtp {
  codeHash: string;
  createdAt: string;
}

export interface DeviceContext {
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  client: ClientKind | null;
}

/** Left behind by a session the one-per-kind rule replaced, so that device can be told why. */
export interface SessionReplacement {
  replacedBy: ClientKind | null;
}
