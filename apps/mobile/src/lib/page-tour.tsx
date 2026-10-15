/// <reference types="nativewind/types" />
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import { seenTours, useTourRun } from '@iace/app-kit';
import { Text } from '../components/ui/text';
import { Button } from '../components/ui/button';
import { STORAGE_KEYS } from './constants';
import { sittingStorage } from './sitting-store';
import { useTokenColor } from './use-token-color';
import { TourContext, useTourContext, type Measurable, type Registration } from './tour-context';
import { cardPlacement, clampedBox, isRingable, ringableSteps, type Box } from './tour-placement';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Check from 'lucide-react-native/icons/check';

const seen = seenTours(sittingStorage, STORAGE_KEYS.TOURS);

const measured = (view: Measurable) =>
  new Promise<Box>((resolve) => {
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });

export function TourProvider({ children }: Readonly<{ children: ReactNode }>) {
  const registered = useRef<Registration | null>(null);
  const targets = useRef(new Map<string, Measurable>());
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  // Which screen's tour is running, so a navigation can tell a departing run from one the arriving screen just opened.
  const [owner, setOwner] = useState<string | null>(null);
  const [box, setBox] = useState<{ target: string; box: Box } | null>(null);
  const { step, index, count, open, next, back, close } = useTourRun();
  const screen = useWindowDimensions();

  const start = useCallback(
    async (opening: Registration) => {
      const boxes = new Map<string, Box>();
      await Promise.all(
        opening.steps.current.map(async ({ target }) => {
          const view = targets.current.get(target);
          if (view !== undefined) boxes.set(target, await measured(view));
        }),
      );
      const live = ringableSteps(opening.steps.current, boxes, screen);
      // The screen may have been left while its targets were being measured.
      if (live.length === 0 || registered.current?.id !== opening.id) return false;
      setOwner(opening.id);
      open(live);
      return true;
    },
    [open, screen],
  );

  const register = useCallback((held: Registration | null) => {
    registered.current = held;
    setRegisteredId(held?.id ?? null);
  }, []);

  // Keyed on the OWNER: a blur and the next screen's focus batch into one update, so null never commits.
  useEffect(() => {
    if (owner !== null && owner !== registeredId) close();
  }, [owner, registeredId, close]);

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
  }, [target, next, screen]);

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
        if (held !== null) void start(held);
      }}
    >
      <CircleQuestionMark color={ink} size={20} />
    </Pressable>
  );
}

/** A stable render prop for a navigator's `headerRight`, rather than a closure rebuilt on every render. */
export const HeaderTourTrigger = () => <TourTrigger />;

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
      <View className="flex-1">
        <Pressable className="flex-1" onPress={onClose}>
          <View className={dim} style={{ left: 0, right: 0, top: 0, height: box.y }} />
          <View className={dim} style={{ left: 0, right: 0, top: box.y + box.height, bottom: 0 }} />
          <View className={dim} style={{ left: 0, width: box.x, top: box.y, height: box.height }} />
          <View
            className={dim}
            style={{ left: box.x + box.width, right: 0, top: box.y, height: box.height }}
          />
        </Pressable>

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
                <Button variant="outline" size="sm" icon={ChevronLeft} onPress={onBack}>
                  Back
                </Button>
              ) : null}
              <Button
                size="sm"
                icon={index + 1 === count ? Check : ChevronRight}
                onPress={index + 1 === count ? onClose : onNext}
              >
                {index + 1 === count ? 'Done' : 'Next'}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
