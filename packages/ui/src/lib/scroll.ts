/** Where a list that pages as it scrolls asks for the next one — a screenful before the end. */
const LOAD_MORE_THRESHOLD_PX = 160;

export interface ScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function nearTheEnd({ scrollTop, scrollHeight, clientHeight }: ScrollViewport): boolean {
  return scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX;
}
