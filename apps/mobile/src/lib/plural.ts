/** "1 test", "12 tests" — the count and its noun, agreeing. Web's own copy lives in `@iace/ui`. */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}
