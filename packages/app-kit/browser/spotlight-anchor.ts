import type { SpotlightRect } from '@iace/ui';

/** Room a tour card needs beside a target: Radix picks a side but never clamps, so the anchor has to leave it one. */
const CARD_ROOM = 220;

/** The target cut to the viewport, and trimmed when it is tall enough that neither side has room — then the card sits inside it. */
export function spotlightAnchor(
  { top, left, width, height }: SpotlightRect,
  viewport: { readonly width: number; readonly height: number },
): SpotlightRect {
  const y = Math.max(top, 0);
  const x = Math.max(left, 0);
  const bottom = Math.min(top + height, viewport.height);
  const trapped = y < CARD_ROOM && bottom > viewport.height - CARD_ROOM;
  return {
    top: y,
    left: x,
    width: Math.max(Math.min(left + width, viewport.width) - x, 0),
    height: Math.max((trapped ? viewport.height - CARD_ROOM : bottom) - y, 0),
  };
}
