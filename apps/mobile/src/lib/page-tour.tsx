/// <reference types="nativewind/types" />
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dimensions, Modal, Pressable, View } from 'react-native';
import { CircleQuestionMark } from 'lucide-react-native';
import { seenTours, useTourRun, type TourStep } from '@iace/app-kit';
import { Text } from '../components/ui/text';
import { Button } from '../components/ui/button';
import { STORAGE_KEYS } from './constants';
import { sittingStorage } from './sitting-store';
import { useTokenColor } from './use-token-color';

interface Registration {
  readonly id: string;
  readonly steps: readonly TourStep[];
}

/** Where a target sits on the window, in device points. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A measurable target — every View has this; declared rather than imported so the ref stays a plain View. */
interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

interface TourContextValue {
  registeredId: string | null;
  registered: RefObject<Registration | null>;
  register: (registration: Registration | null) => void;
  targets: RefObject<Map<string, Measurable>>;
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

const seen = seenTours(sittingStorage, STORAGE_KEYS.TOURS);

/** Registers a view as a tour target. Spread the result on the View the step points at. */
export function useTourTarget(key: string): { ref: (view: Measurable | null) => void } {
  const { targets } = useTourContext();

  const ref = useCallback(
    (view: Measurable | null) => {
      if (view === null) {
        targets.current.delete(key);
        return;
      }
      targets.current.set(key, view);
    },
    [targets, key],
  );

  return { ref };
}

export function TourProvider({ children }: Readonly<{ children: ReactNode }>) {
  const registered = useRef<Registration | null>(null);
  const targets = useRef(new Map<string, Measurable>());
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const { step, index, count, open, next, back, close } = useTourRun();

  const start = useCallback(
    (opening: Registration) => {
      const live = opening.steps.filter((one) => targets.current.has(one.target));
      if (live.length === 0) return false;
      open(live);
      return true;
    },
    [open],
  );

  const register = useCallback((held: Registration | null) => {
    registered.current = held;
    setRegisteredId(held?.id ?? null);
  }, []);

  // A screen leaving takes its tour with it. Not on the first pass: children register in their own effects.
  const everRegistered = useRef(false);
  useEffect(() => {
    if (registeredId !== null) {
      everRegistered.current = true;
      return;
    }
    if (!everRegistered.current) return;
    everRegistered.current = false;
    close();
  }, [registeredId, close]);

  const target = step?.target ?? null;

  useEffect(() => {
    if (target === null) return;
    const view = targets.current.get(target);
    if (view === undefined) {
      next();
      return;
    }
    // measureInWindow rather than onLayout: a rect is wanted once per step, not on every layout pass.
    view.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) {
        next();
        return;
      }
      setBox({ x, y, width, height });
    });
  }, [target, next]);

  const value = useMemo(
    () => ({
      registeredId,
      registered,
      register,
      targets,
      start,
      hasSeen: seen.has,
      mark: seen.mark,
    }),
    [registeredId, register, start],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {step !== null && box !== null ? (
        <Spotlight
          box={box}
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

  useEffect(() => {
    register({ id, steps });
    return () => register(null);
  }, [register, id, steps]);

  useEffect(() => {
    if (attempted.current || !ready || hasSeen(id)) return;
    attempted.current = true;
    // Marked only when it OPENED: a screen whose targets had not mounted yet gets another chance.
    if (start({ id, steps })) mark(id);
  }, [ready, id, steps, start, hasSeen, mark]);
}

/** Absent on a screen that registered no tour, so a screen without the hook shows no dead control. */
export function TourTrigger() {
  const { registeredId, registered, start } = useTourContext();
  const ink = useTokenColor('--muted-foreground');
  if (registeredId === null) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Tour this page"
      hitSlop={12}
      onPress={() => {
        const held = registered.current;
        if (held !== null) start(held);
      }}
    >
      <CircleQuestionMark color={ink} size={20} />
    </Pressable>
  );
}

/** Four dim panes around the target, because React Native has neither `clip-path` nor a shadow spread. */
function Spotlight({
  box,
  title,
  body,
  index,
  count,
  onNext,
  onBack,
  onClose,
}: Readonly<{
  box: Box;
  title: string;
  body: string;
  index: number;
  count: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}>) {
  const window = Dimensions.get('window');
  const below = box.y + box.height < window.height / 2;
  const dim = 'absolute bg-foreground/60';

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="flex-1" onPress={onClose}>
        <View className={dim} style={{ left: 0, right: 0, top: 0, height: box.y }} />
        <View className={dim} style={{ left: 0, right: 0, top: box.y + box.height, bottom: 0 }} />
        <View className={dim} style={{ left: 0, width: box.x, top: box.y, height: box.height }} />
        <View
          className={dim}
          style={{ left: box.x + box.width, right: 0, top: box.y, height: box.height }}
        />

        <View
          className="absolute rounded-xl border border-border bg-surface p-4"
          style={
            below
              ? { left: 16, right: 16, top: box.y + box.height + 12 }
              : { left: 16, right: 16, bottom: window.height - box.y + 12 }
          }
        >
          <Text variant="subsection">{title}</Text>
          <Text variant="muted" className="mt-1">
            {body}
          </Text>
          <View className="mt-4 flex-row items-center justify-between gap-3">
            <Text variant="meta">{`${index + 1} of ${count}`}</Text>
            <View className="flex-row items-center gap-2">
              <Button variant="ghost" size="sm" onPress={onClose}>
                Skip
              </Button>
              {index > 0 ? (
                <Button variant="outline" size="sm" onPress={onBack}>
                  Back
                </Button>
              ) : null}
              <Button size="sm" onPress={index + 1 === count ? onClose : onNext}>
                {index + 1 === count ? 'Done' : 'Next'}
              </Button>
            </View>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
