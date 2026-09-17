/** The port `pnpm dev` serves the API on, beside Metro on the same machine. */
export const DEV_API_PORT = 3000;

/** How an Android emulator addresses the machine it runs on; its own 127.0.0.1 is itself. */
const ANDROID_EMULATOR_HOST = '10.0.2.2';

const LOOPBACK = new Set(['localhost', '127.0.0.1']);

/** In development the API runs beside Metro, so the host the bundle came from reaches it too. */
export function devApiUrl(metroHostUri: string | undefined, platform: string): string | undefined {
  const host = metroHostUri?.split(':')[0];
  if (!host) return undefined;
  const reachable = platform === 'android' && LOOPBACK.has(host) ? ANDROID_EMULATOR_HOST : host;
  return `http://${reachable}:${DEV_API_PORT}`;
}
