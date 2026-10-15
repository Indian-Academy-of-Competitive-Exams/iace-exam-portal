import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleQuestionMark } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TourSpotlight,
  type SpotlightRect,
} from '@iace/ui';
import { seenTours, useTourRun, type KeyValueStorage } from '../src';
import { spotlightAnchor } from './spotlight-anchor';
import { TourContext, useTourContext, type Registration } from './tour-context';

function targetElement(target: string): Element | null {
  return document.querySelector(`[data-tour="${target}"]`);
}

/** A control measuring nothing is one nobody can see pointed at, so it counts as absent. */
function boxOf(target: string): SpotlightRect | null {
  const element = targetElement(target);
  if (element === null) return null;
  const { top, left, width, height } = element.getBoundingClientRect();
  return width === 0 || height === 0 ? null : { top, left, width, height };
}

export function TourProvider({
  storage,
  storageKey,
  children,
}: Readonly<{ storage: KeyValueStorage; storageKey: string; children: ReactNode }>) {
  const seen = useMemo(() => seenTours(storage, storageKey), [storage, storageKey]);
  const registered = useRef<Registration | null>(null);
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  // Which screen's tour is running, so a route swap can tell a departing run from one the arriving screen just opened.
  const [owner, setOwner] = useState<string | null>(null);
  // Held with the target it was measured for: a replay would otherwise paint one frame at the box the last run ended on.
  const [rect, setRect] = useState<{
    target: string;
    box: SpotlightRect;
    anchor: SpotlightRect;
  } | null>(null);
  // Every callback here is stable, which is why nothing in this file needs to keep the run in a ref.
  const { step, index, count, open, next, back, close } = useTourRun();

  const start = useCallback(
    (opening: Registration) => {
      const live = opening.steps.current.filter((one) => boxOf(one.target) !== null);
      if (live.length === 0) return false;
      setOwner(opening.id);
      open(live);
      return true;
    },
    [open],
  );

  const register = useCallback((next: Registration | null) => {
    registered.current = next;
    setRegisteredId(next?.id ?? null);
  }, []);

  // Keyed on the OWNER: a route swap batches both registrations, so the id never commits as null.
  useEffect(() => {
    if (owner !== null && owner !== registeredId) close();
  }, [owner, registeredId, close]);

  const target = step?.target ?? null;

  useEffect(() => {
    if (target === null) return;
    targetElement(target)?.scrollIntoView({ block: 'center' });
    const measure = () => {
      const box = boxOf(target);
      if (box === null) {
        next();
        return;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setRect({ target, box, anchor: spotlightAnchor(box, viewport) });
    };
    measure();
    window.addEventListener('resize', measure);
    // Captured, because the blocker stops clicks but not the wheel, and a scrolled target leaves its cutout behind.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target, next]);

  const value = useMemo(
    () => ({ registeredId, registered, register, start, hasSeen: seen.has, mark: seen.mark }),
    [registeredId, register, start, seen],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {step !== null && rect !== null && rect.target === step.target ? (
        <TourSpotlight
          rect={rect.box}
          anchor={rect.anchor}
          title={step.title}
          body={step.body}
          index={index}
          count={count}
          onNext={next}
          onBack={back}
          onClose={close}
        />
      ) : null}
    </TourContext.Provider>
  );
}

/** Absent on a screen that registered no tour, so a page without the hook cannot show a dead control. */
export function TourTrigger() {
  const { registeredId, registered, start } = useTourContext();
  if (registeredId === null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Tour this page"
          onClick={() => {
            const held = registered.current;
            if (held !== null) start(held);
          }}
        >
          <CircleQuestionMark aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Tour this page</TooltipContent>
    </Tooltip>
  );
}
