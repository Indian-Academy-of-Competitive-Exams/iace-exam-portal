/**
 * libuv fixes its thread pool the first time anything uses it, so nothing in code can resize it —
 * only the process environment can, before Node starts. argon2 and gzip both run there.
 */

/** Measured: 4 threads cap argon2 at ~235 verifies/s, 16 at ~350, and gzip queues behind either. */
export const THREADPOOL_FLOOR = 16;

/** Null when the pool is sized for a container serving HTTP. A worker needs no more than the default. */
export function threadpoolRisk(raw: string | undefined): string | null {
  const size = Number(raw);
  if (Number.isInteger(size) && size >= THREADPOOL_FLOOR) return null;

  const held = raw === undefined ? 'unset, so libuv runs 4' : `"${raw}"`;
  return `UV_THREADPOOL_SIZE is ${held} — argon2 and gzip share that pool, so a login burst queues response compression behind it. Set it to ${THREADPOOL_FLOOR} wherever this serves HTTP.`;
}
