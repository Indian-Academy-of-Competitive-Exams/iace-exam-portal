import { type Request } from 'express';
import { type DeviceContext } from './auth.types';

/**
 * What we record about the device a session was opened from.
 *
 * One definition, used by every route that issues a session. A second copy —
 * and there was nearly one, on the PIN-change route — is how two sessions for
 * the same person end up recorded differently, which makes the device list a
 * student is shown for security purposes quietly wrong.
 *
 * `deviceId` and `deviceName` are CLAIMED by the client and trusted only as
 * labels. They are never an authorisation input.
 */
export function deviceFrom(
  request: Request,
  claimed?: { deviceId?: string; deviceName?: string },
): DeviceContext {
  return {
    deviceId: claimed?.deviceId ?? null,
    deviceName: claimed?.deviceName ?? null,
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
