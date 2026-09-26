import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CircleQuestionMark } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TourSpotlight,
  type SpotlightRect,
} from '@iace/ui';
import { seenTours, useTourRun, type KeyValueStorage, type TourStep } from '../src';

/** What a mounted screen declares about itself. The mounted page IS the registry: no route table to keep in step with the router. */
interface Registration {
  readonly id: string;
  /** A ref, not an array: a screen writing its steps inline hands a new one every render, and registering on that identity loops. */
  readonly steps: { readonly current: readonly TourStep[] };
}

interface TourContextValue {
  /** The id alone, because it is all the trigger needs to decide whether to draw — and a steps array a screen built inline would change identity on every render. */
  registeredId: string | null;
  registered: { readonly current: Registration | null };
  register: (registration: Registration | null) => void;
  /** Opens whatever of the registration can actually be pointed at; false when none of it can. */
  start: (registration: Registration) => boolean;
  hasSeen: (id: string) => boolean;
  mark: (id: string) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

function useTourContext(): TourContextValue {
  const held = useContext(TourContext);
  if (held === null) throw new Error('usePageTour needs a TourProvider above it');
  return held;
}

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
  const [rect, setRect] = useState<{ target: string; box: SpotlightRect } | null>(null);
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
      setRect({ target, box });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
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

/** One call per screen: it puts the header's help icon on, and opens the tour once on a first visit. */
export function usePageTour({
  id,
  steps,
  ready,
}: Readonly<{ id: string; steps: readonly TourStep[]; ready: boolean }>): void {
  const { register, start, hasSeen, mark } = useTourContext();
  const attempted = useRef(false);
  const latest = useRef(steps);

  // Synced in an effect, never during render: the React Compiler rules refuse a ref written while rendering.
  useEffect(() => {
    latest.current = steps;
  }, [steps]);

  // Keyed on the ID alone. A screen that builds its steps inline would otherwise re-register on every render.
  useEffect(() => {
    register({ id, steps: latest });
    return () => register(null);
  }, [register, id]);

  useEffect(() => {
    if (attempted.current || !ready || hasSeen(id)) return;
    attempted.current = true;
    // Marked only when it OPENED: a screen whose targets had not painted yet gets another chance on the next visit.
    if (start({ id, steps: latest })) mark(id);
  }, [ready, id, start, hasSeen, mark]);
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
