import { type ActorType } from '@iace/contracts';

/** What the JWT guard attaches to the request after a token checks out. */
export interface AuthenticatedUser {
  id: string;
  actor: ActorType;
  /** Redis session id — the handle a logout revokes. */
  sessionId: string;
  isSuperAdmin: boolean;
  pages: string[];
}

/** The Redis-resident half of a session. Never written to Postgres. */
export interface StoredSession {
  refreshTokenHash: string;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

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
}
