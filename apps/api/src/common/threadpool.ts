/**
 * libuv fixes its thread pool the first time anything uses it, so nothing in code can resize it —
 * only the process environment can, before Node starts. Response gzip runs there.
 */

/** Set when PIN hashing shared the pool. Gzip alone has not been measured, so the floor stays where it was. */
export const THREADPOOL_FLOOR = 16;

/** Null when the pool is sized for a container serving HTTP. A worker needs no more than the default. */
export function threadpoolRisk(raw: string | undefined): string | null {
  const size = Number(raw);
  if (Number.isInteger(size) && size >= THREADPOOL_FLOOR) return null;

  const held = raw === undefined ? 'unset, so libuv runs 4' : `"${raw}"`;
  return `UV_THREADPOOL_SIZE is ${held} — response gzip runs on that pool, so a burst of large answers queues behind it. Set it to ${THREADPOOL_FLOOR} wherever this serves HTTP.`;
}
