/**
 * V8 fixes its heap before any of this runs, so nothing here can set it — only say it is wrong.
 * Too high and the kernel kills the process at the cgroup limit before V8 collects, which arrives
 * as exit 137 with no stack; too low and Node's own ~50% default leaves memory the task pays for
 * unused. Each of the three roles runs at a different size, so each needs its own answer.
 */
import { readFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { apiRole } from '../config/api-role';

/** Buffers, the Prisma engine and thread stacks live OUTSIDE the heap, so the cap is never the whole box. */
export const HEAP_SHARE_OF_MEMORY = 0.8;

/** Node's unset default is about half the container, which is under this and so reads as unset. */
export const HEAP_SHARE_FLOOR = 0.6;

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

const asMb = (bytes: number) => Math.round(bytes / MB);

/** Named so the line says which of the three task definitions to go and edit. */
const fix = (role: string, want: number) =>
  `Set NODE_OPTIONS=--max-old-space-size=${asMb(want)} (megabytes) on the ${role} service.`;

/** Null when the heap sits in the band; a sentence naming both numbers when it is over or under. */
export function heapRisk(
  heapLimit: number,
  containerLimit: number | null,
  role: string = apiRole,
): string | null {
  if (containerLimit === null) return null;
  const want = containerLimit * HEAP_SHARE_OF_MEMORY;

  if (heapLimit > want) {
    return `V8 may grow its heap to ${asMb(heapLimit)} MB inside a ${asMb(containerLimit)} MB container — the kernel kills the process at the limit before V8 collects, and an OOM kill leaves no stack trace. ${fix(role, want)}`;
  }
  if (heapLimit < containerLimit * HEAP_SHARE_FLOOR) {
    return `V8 will use at most ${asMb(heapLimit)} MB of this ${asMb(containerLimit)} MB container, so ${asMb(want - heapLimit)} MB it is paying for goes to GC pressure instead of headroom — which is what an unset NODE_OPTIONS looks like. ${fix(role, want)}`;
  }
  return null;
}

/** What the running process is actually allowed, for the boot check to read. */
export const heapLimitNow = (): number => getHeapStatistics().heap_size_limit;
