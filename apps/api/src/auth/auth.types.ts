/**
 * Auth's own internal shapes.
 *
 * `AuthenticatedUser` deliberately is NOT here — it is the one type every other
 * controller has to name, so it lives in `common/security` (docs/03 §4).
 * Everything below is auth's business alone.
 */

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
