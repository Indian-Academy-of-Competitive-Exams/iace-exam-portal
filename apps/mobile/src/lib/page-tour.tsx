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
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CircleQuestionMark } from 'lucide-react-native';
import { seenTours, useTourRun, type TourStep } from '@iace/app-kit';
import { Text } from '../components/ui/text';
import { Button } from '../components/ui/button';
import { STORAGE_KEYS } from './constants';
import { sittingStorage } from './sitting-store';
import { useTokenColor } from './use-token-color';
import { cardPlacement, clampedBox, isRingable, type Box } from './tour-placement';

interface Registration {
  readonly id: string;
  /** A ref, not an array: a screen writing its steps inline hands a new one every render. */
  readonly steps: { readonly current: readonly TourStep[] };
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

/** Registers a view as a tour target; an undefined key attaches nothing, so a list can anchor its first row alone. */
export function useTourTarget(key?: string): { ref?: (view: Measurable | null) => void } {
  const { targets } = useTourContext();

  const ref = useCallback(
    (view: Measurable | null) => {
      if (key === undefined) return;
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
  // Which screen's tour is running, so a navigation can tell a departing run from one the arriving screen just opened.
  const [owner, setOwner] = useState<string | null>(null);
  const [box, setBox] = useState<{ target: string; box: Box } | null>(null);
  const { step, index, count, open, next, back, close } = useTourRun();

  const start = useCallback(
    (opening: Registration) => {
      const live = opening.steps.current.filter((one) => targets.current.has(one.target));
      if (live.length === 0) return false;
      setOwner(opening.id);
      open(live);
      return true;
    },
    [open],
  );

  const register = useCallback((held: Registration | null) => {
    registered.current = held;
    setRegisteredId(held?.id ?? null);
  }, []);

  // Keyed on the OWNER: a blur and the next screen's focus batch into one update, so null never commits.
  useEffect(() => {
    if (owner !== null && owner !== registeredId) close();
  }, [owner, registeredId, close]);

  const screen = useWindowDimensions();
  const target = step?.target ?? null;

  useEffect(() => {
    if (target === null) return;
    const view = targets.current.get(target);
    if (view === undefined) {
      next();
      return;
    }
    // A superseded step's callback must not land on the next step's box.
    let live = true;
    // measureInWindow rather than onLayout: a rect is wanted once per step, not on every layout pass.
    view.measureInWindow((x, y, width, height) => {
      if (!live) return;
      if (!isRingable({ x, y, width, height }, screen)) {
        next();
        return;
      }
      setBox({ target, box: { x, y, width, height } });
    });
    return () => {
      live = false;
    };
  }, [target, next, screen.height]);

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
      {step !== null && box !== null && box.target === step.target ? (
        <Spotlight
          box={box.box}
          screen={screen}
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

  // Synced in an effect, never during render, and read through the ref so an inline steps array cannot re-register.
  useEffect(() => {
    latest.current = steps;
  }, [steps]);

  // On FOCUS, not on mount: nothing unmounts on blur here, so a mount-time claim is never handed back.
  useFocusEffect(
    useCallback(() => {
      register({ id, steps: latest });
      return () => register(null);
    }, [register, id]),
  );

  useEffect(() => {
    if (attempted.current || !ready || hasSeen(id)) return;
    attempted.current = true;
    // Marked only when it OPENED: a screen whose targets had not mounted yet gets another chance.
    if (start({ id, steps: latest })) mark(id);
  }, [ready, id, start, hasSeen, mark]);
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

/** A stable render prop for a navigator's `headerRight`, rather than a closure rebuilt on every render. */
export const renderTourTrigger = () => <TourTrigger />;

/** Four dim panes around the target, because React Native has neither `clip-path` nor a shadow spread. */
function Spotlight({
  box: measured,
  screen,
  title,
  body,
  index,
  count,
  onNext,
  onBack,
  onClose,
}: Readonly<{
  box: Box;
  screen: { width: number; height: number };
  title: string;
  body: string;
  index: number;
  count: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}>) {
  const box = clampedBox(measured, screen);
  const dim = 'absolute bg-[var(--overlay-bg)]';

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
          className="absolute gap-1 rounded-xl border border-border bg-surface p-4"
          style={{ left: 16, right: 16, ...cardPlacement(box, screen) }}
        >
          <Text variant="subsection">{title}</Text>
          <Text variant="muted">{body}</Text>
          <View className="mt-3 flex-row items-center justify-between gap-3">
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
