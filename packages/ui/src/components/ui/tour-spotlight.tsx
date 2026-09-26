import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Button } from './button';

/** Where the thing being pointed at is, in viewport pixels. A rect rather than an element: this package draws, it does not query the DOM. */
export interface SpotlightRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface TourSpotlightProps {
  rect: SpotlightRect;
  title: string;
  body: string;
  index: number;
  count: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}

const CARD = [
  'z-[--z-popover] w-[min(20rem,calc(100vw-2rem))] rounded-[--modal-radius] border border-border',
  'flex flex-col gap-1 bg-surface p-4 text-foreground shadow-[--shadow-overlay] focus:outline-none',
  'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
].join(' ');

/** One stop on a page tour: the page dimmed except for one control, and a card beside it. */
export function TourSpotlight({
  rect,
  title,
  body,
  index,
  count,
  onNext,
  onBack,
  onClose,
}: Readonly<TourSpotlightProps>) {
  return (
    <PopoverPrimitive.Root open>
      {/* Swallows clicks so the page below cannot be navigated mid-tour; it does NOT dismiss, or a mis-tap ends the run. Escape and Skip the tour are the ways out. */}
      <div
        data-tour-blocker
        aria-hidden
        className="fixed inset-0 z-[--z-overlay] animate-overlay-in"
      />
      {/* One element paints the dim AND the hole: a shadow spread wider than any viewport, with nothing inside it. */}
      <div
        data-tour-cutout
        aria-hidden
        style={{ ...rect, boxShadow: '0 0 0 9999px var(--overlay-bg)' }}
        className="pointer-events-none fixed z-[--z-overlay] rounded-md"
      />
      <PopoverPrimitive.Anchor style={rect} className="pointer-events-none fixed z-[--z-overlay]" />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          onEscapeKeyDown={onClose}
          onInteractOutside={(event) => event.preventDefault()}
          className={CARD}
        >
          {/* A <p>, not a heading: a heading here would make `no-narration` read tour copy as a narrative title. */}
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {index + 1} of {count}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Skip the tour
              </Button>
              {index > 0 ? (
                <Button variant="outline" size="sm" onClick={onBack}>
                  Back
                </Button>
              ) : null}
              {index + 1 === count ? (
                <Button size="sm" onClick={onClose}>
                  Done
                </Button>
              ) : (
                <Button size="sm" onClick={onNext}>
                  Next
                </Button>
              )}
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
