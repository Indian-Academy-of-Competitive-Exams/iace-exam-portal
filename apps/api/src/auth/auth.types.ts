import { type ClientKind } from '@iace/contracts';

/** Auth's own internal shapes. */

/** The Redis-resident half of a session. Never written to Postgres. */
export interface StoredSession {
  refreshTokenHash: string;
  deviceId: string | null;
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

/** The Redis-resident half of a pending OTP. The code itself is never stored. */
export interface StoredOtp {
  codeHash: string;
  attempts: number;
  createdAt: string;
}

export interface DeviceContext {
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  client: ClientKind | null;
}

/** Left behind by a session the one-per-kind rule replaced, so that device can be told why. */
export interface SessionReplacement {
  replacedBy: ClientKind | null;
}
