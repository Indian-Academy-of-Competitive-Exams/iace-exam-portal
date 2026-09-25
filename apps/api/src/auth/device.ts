import { type Request } from 'express';
import { CLIENT_HEADERS, CLIENT_KINDS, clientKindSchema } from '@iace/contracts';
import { type DeviceContext } from './auth.types';

const MAX_NAME = 128;

/** Order matters: Edge, Opera, Samsung Internet and iOS engines all also claim Chrome or Safari. */
const BROWSERS = [
  ['EdgA/', 'Edge'],
  ['EdgiOS/', 'Edge'],
  ['SamsungBrowser/', 'Samsung Internet'],
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['CriOS/', 'Chrome'],
  ['FxiOS/', 'Firefox'],
  ['Firefox/', 'Firefox'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
] as const;

/** Order matters: iPhone and iPad also claim Mac OS X, Android also claims Linux, and ChromeOS also claims Linux. */
const SYSTEMS = [
  ['Windows', 'Windows'],
  ['Android', 'Android'],
  ['iPhone', 'iOS'],
  ['iPad', 'iPadOS'],
  ['Mac OS X', 'macOS'],
  ['CrOS', 'ChromeOS'],
  ['Linux', 'Linux'],
] as const;

function firstHeader(value: string | string[] | undefined): string | null {
  const text = (Array.isArray(value) ? value[0] : value)?.trim().slice(0, MAX_NAME);
  if (!text) return null;
  return text;
}

/** A web session's name, since a browser cannot say which machine it runs on. */
export function browserLabel(userAgent: string | null): string {
  if (!userAgent) return 'A web browser';
  const browser = BROWSERS.find(([mark]) => userAgent.includes(mark))?.[1];
  const system = SYSTEMS.find(([mark]) => userAgent.includes(mark))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? 'A web browser';
}

/** What we record about the device a session was opened from. */
export function deviceFrom(request: Request, claimed?: { deviceName?: string }): DeviceContext {
  const userAgent = request.headers['user-agent'] ?? null;
  const client =
    clientKindSchema.safeParse(firstHeader(request.headers[CLIENT_HEADERS.KIND])).data ?? null;
  const named = claimed?.deviceName ?? firstHeader(request.headers[CLIENT_HEADERS.DEVICE_NAME]);
  return {
    deviceName: named ?? (client === CLIENT_KINDS.WEB ? browserLabel(userAgent) : null),
    ip: request.ip ?? null,
    userAgent,
    client,
  };
}
