import { REVIEW_STATES, type ReviewState } from '@iace/contracts';

/** Whether a question waits on the viewer: sent back for its typist, not yet passed for its reader. */
export function awaitsViewer(
  seat: Readonly<{ reading: boolean; fixing: boolean }>,
  state: ReviewState,
): boolean {
  if (state === REVIEW_STATES.SENT_BACK) return seat.fixing;
  return seat.reading && state !== REVIEW_STATES.CHECKED;
}

/** Seconds each question has been on screen this visit: counted for the one in view, and reported in batches. */
export class WorkClock {
  private readonly counted = new Map<string, number>();
  private readonly unsent = new Map<string, number>();
  private readonly bases = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private watched: string | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The question now on screen; null while nothing is being counted. */
  watch(key: string | null): void {
    this.watched = key;
  }

  /** One second on the question in view. */
  tick(): void {
    const key = this.watched;
    if (key === null) return;
    add(this.counted, key, 1);
    add(this.unsent, key, 1);
    for (const listener of this.listeners) listener();
  }

  /** The total to show: what the server held when this question was first drawn, and every second since. */
  shown(key: string, held: number): number {
    // Held once: a later read of the section already includes what this visit reported.
    if (!this.bases.has(key)) this.bases.set(key, held);
    return (this.bases.get(key) ?? 0) + (this.counted.get(key) ?? 0);
  }

  /** What is not reported yet, at most `most` a question, handed over; `giveBack` returns a report that failed. */
  take(most: number, skip?: string): [key: string, seconds: number][] {
    const batch: [string, number][] = [];
    for (const [key, seconds] of this.unsent) {
      if (key === skip) continue;
      const sent = Math.min(seconds, most);
      batch.push([key, sent]);
      if (seconds > sent) this.unsent.set(key, seconds - sent);
      else this.unsent.delete(key);
    }
    return batch;
  }

  giveBack(key: string, seconds: number): void {
    add(this.unsent, key, seconds);
  }

  /** The blank card's time belongs to the question its save created. */
  move(from: string, to: string): void {
    for (const seconds of [this.counted, this.unsent]) {
      const moved = seconds.get(from);
      if (moved === undefined) continue;
      seconds.delete(from);
      add(seconds, to, moved);
    }
    this.bases.delete(from);
    for (const listener of this.listeners) listener();
  }
}

function add(seconds: Map<string, number>, key: string, more: number): void {
  seconds.set(key, (seconds.get(key) ?? 0) + more);
}
