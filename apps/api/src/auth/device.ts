import { type Request } from 'express';
import { type DeviceContext } from './auth.types';

/** What we record about the device a session was opened from. */
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
