/** Where a target sits on the window, in device points. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Screen {
  width: number;
  height: number;
}

/** How much room the card needs before it will sit on one side of the target rather than the other. */
const CARD_ROOM = 160;
const CARD_GAP = 12;

/** Where the card goes: under the target, over it, or centred when neither side has the room. */
export function cardPlacement(box: Box, screen: Screen): { top: number } | { bottom: number } {
  const under = screen.height - (box.y + box.height);
  if (under >= CARD_ROOM) return { top: box.y + box.height + CARD_GAP };
  if (box.y >= CARD_ROOM) return { bottom: screen.height - box.y + CARD_GAP };
  return { top: Math.max(CARD_GAP, (screen.height - CARD_ROOM) / 2) };
}

/** The target cut to the window: an edge off screen would otherwise give a dim pane a negative size. */
export function clampedBox(box: Box, screen: Screen): Box {
  const y = Math.max(0, Math.min(box.y, screen.height));
  const x = Math.max(0, Math.min(box.x, screen.width));
  return {
    x,
    y,
    width: Math.max(0, Math.min(box.x + box.width, screen.width) - x),
    height: Math.max(0, Math.min(box.y + box.height, screen.height) - y),
  };
}

/** A target with no size, or none of it on screen, cannot be rung — and there is no scrollIntoView to reach for. */
export function isRingable(box: Box, screen: Screen): boolean {
  if (box.width === 0 || box.height === 0) return false;
  return box.y + box.height > 0 && box.y < screen.height;
}
