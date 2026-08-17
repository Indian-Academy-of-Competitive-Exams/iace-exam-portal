import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "1 student", "240 students" — the count and its noun, agreeing.
 *
 * Copy that says "1 students" reads as a bug in the number rather than in the
 * sentence, and a confirmation dialog is the last place to look sloppy about a
 * count somebody is about to act on. The noun is a parameter, so this knows
 * nothing about what is being counted.
 */
export function plural(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
