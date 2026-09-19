import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Every ancestor between a frame and its scroller: without min-h-0 the scroll goes to the page. */
export const FILLS = 'flex min-h-0 flex-1 flex-col';

/** "1 student", "240 students" — the count and its noun, agreeing. */
export function plural(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
