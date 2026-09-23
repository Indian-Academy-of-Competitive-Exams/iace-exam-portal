/**
 * V8 sizes its heap from the memory it can see, which in a container is not always the container's.
 * A cap above the cgroup limit is killed by the kernel as exit 137 — no stack, no log, just a task
 * that restarted — so the heap is read at boot and compared against the limit it actually runs under.
 */
import { readFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';

/** Buffers, the Prisma engine and thread stacks live OUTSIDE the heap, so the cap is never the whole box. */
export const HEAP_SHARE_OF_MEMORY = 0.8;

const MB = 1024 * 1024;

/** cgroup v2 first, then v1: one of the two is mounted, and neither exists off Linux. */
const CGROUP_MEMORY_FILES = [
  '/sys/fs/cgroup/memory.max',
  '/sys/fs/cgroup/memory/memory.limit_in_bytes',
] as const;

/** The one thing this needs from the filesystem, so a test can hand it a string. */
type ReadText = (file: string) => string;

const readText: ReadText = (file) => readFileSync(file, 'utf8');

/** Null when nothing constrains this process — a developer's laptop, or a container run without a limit. */
export function containerMemoryLimit(read: ReadText = readText): number | null {
  for (const file of CGROUP_MEMORY_FILES) {
    try {
      const bytes = Number(read(file).trim());
      // v1 reports a number near 2^63 rather than "max" when there is no limit.
      if (Number.isSafeInteger(bytes) && bytes > 0 && bytes < Number.MAX_SAFE_INTEGER) return bytes;
    } catch {
      continue;
    }
  }
  return null;
}

/** Null when the heap fits, a sentence naming both numbers when it does not. */
export function heapRisk(heapLimit: number, containerLimit: number | null): string | null {
  if (containerLimit === null) return null;
  const safe = containerLimit * HEAP_SHARE_OF_MEMORY;
  if (heapLimit <= safe) return null;

  const asMb = (bytes: number) => Math.round(bytes / MB);
  return `V8 may grow its heap to ${asMb(heapLimit)} MB inside a ${asMb(containerLimit)} MB container — the kernel kills the process at the limit before V8 collects, and an OOM kill leaves no stack trace. Set NODE_OPTIONS=--max-old-space-size=${asMb(safe)} (megabytes) on this service.`;
}

/** What the running process is actually allowed, for the boot check to read. */
export const heapLimitNow = (): number => getHeapStatistics().heap_size_limit;
