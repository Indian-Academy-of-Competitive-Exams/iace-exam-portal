/**
 * The engine. It holds the sitting — where the candidate is, what they have
 * answered, when the clock ends, what a submit does — and hands a template the
 * finished view. What a sectional clock changes is which sections are open, and
 * that is read from the config rather than branched into a second screen.
 */
import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ANSWER_STATE,
  furthestSeat,
  isReviewState,
  mayOpenQuestion,
  NAVIGATION_POLICY,
  omrStateFor,
  nextOpenSectionId,
  nextQuestionId,
  openSections,
  paletteCounts,
  sectionEffort,
  sectionLeftSec,
  sectionPaletteCounts,
  TIMER_TEMPLATE,
  type ExamClock,
  type ExamPaper,
  type SectionEffort,
} from '@iace/contracts';
import { shouldRetrySubmit, SUBMIT_TIMEOUT_MS, submitRetryDelayMs } from '../autosave-policy';
import { type FullscreenHandle } from './focus-guard';
import { useAttemptState, type AnswerIntent, type AttemptStateDeps } from './use-attempt-state';
import {
  TIMER_KIND,
  type ExamFullscreenView,
  type ExamSubmitView,
  type ExamTimerView,
  type ExamView,
} from './exam-view';

/** What the engine cannot know: the autosave's own deps, whose cache key, and how this platform reports focus. */
export interface ExamEngineDeps extends AttemptStateDeps {
  focus: FullscreenHandle;
  catalogQueryKey: QueryKey;
}

/** What the sitting knows about itself the moment it ends, before anything has been marked. */
export interface EndedSitting {
  attemptId: string;
  sections: SectionEffort[];
}

export interface ExamSitting {
  paper: ExamPaper;
  /** `Date.now()` when the paper landed, so device skew cancels out of the countdown. */
  arrivedAt: number;
  title: string | null;
  watermark: string;
  onEnded: (sitting: EndedSitting) => void;
}

export function useExamView(
  { paper, arrivedAt, title, watermark, onEnded }: Readonly<ExamSitting>,
  deps: Readonly<ExamEngineDeps>,
): ExamView {
  const { api, focus, catalogQueryKey, tab } = deps;
  const queryClient = useQueryClient();
  const [ignoringFullscreen, setIgnoringFullscreen] = useState(0);
  const state = useAttemptState(paper.attemptId, deps);
  const [sectionId, setSectionId] = useState(paper.sections[0]?.id ?? '');
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  // A ref, not `submit.isPending`: the clock and a tap can both end the paper before the next render.
  const ending = useRef(false);
  const paperClock = useMemo<ExamClock>(
    () => ({ endsAt: paper.endsAt, serverNow: paper.serverNow, arrivedAt }),
    [paper.endsAt, paper.serverNow, arrivedAt],
  );
  // The paper's clock until a save answers with a newer one — that is how an extension lands.
  const clock = state.clock ?? paperClock;

  const sectional = paper.timerTemplate !== TIMER_TEMPLATE.COMPOSITE_FREE;
  const forwardOnly = paper.navigation === NAVIGATION_POLICY.FORWARD_ONLY;
  const reachable = useMemo(
    () => openSections(paper.sections, sectional, state.sections),
    [paper.sections, sectional, state.sections],
  );
  // Drawn but inert until the server says which section is open: the one on screen may already be closed.
  const inert = sectional && !state.sectionsSettled;

  // A reload must land where the sitting really is, not the paper's first section.
  if (sectional && reachable[0] !== undefined && reachable[0] !== sectionId) {
    setSectionId(reachable[0]);
  }

  const firstReachable = reachable[0];
  const { sectionsSettled, sections: heldSections, enterSection } = state;
  // Stamps a section's clock the first time it is truly known to have never been opened.
  useEffect(() => {
    if (!sectional || !sectionsSettled) return;
    if (firstReachable === undefined || heldSections[firstReachable] !== undefined) return;
    const allowed = paper.sections.find((row) => row.id === firstReachable)?.durationSec;
    if (allowed !== null && allowed !== undefined) enterSection(firstReachable, allowed);
  }, [sectional, sectionsSettled, firstReachable, heldSections, paper.sections, enterSection]);

  const section = paper.sections.find((row) => row.id === sectionId);
  // Memoized down this whole block: every one of them walks the paper, and a sitting re-renders per tap and per second.
  const inSection = useMemo(
    () => paper.questions.filter((row) => row.baseConfigSectionId === sectionId),
    [paper.questions, sectionId],
  );
  const order = useMemo(() => inSection.map((row) => row.questionId), [inSection]);
  // A forward-only reload lands where the candidate had got to, not on a seat already left.
  const landing = useMemo(
    () => (forwardOnly ? Math.max(0, furthestSeat(order, state.answers)) : 0),
    [forwardOnly, order, state.answers],
  );
  const current = inSection.find((row) => row.questionId === questionId) ?? inSection[landing];
  const onScreen = current?.questionId;
  const { open } = state;
  // Landed on, not moved to, and only once the server has said where the sitting is: before, it may be a closed section.
  useEffect(() => {
    if (sectionsSettled && onScreen !== undefined) open(onScreen);
  }, [sectionsSettled, onScreen, open]);
  const paperOrder = useMemo(() => paper.questions.map((row) => row.questionId), [paper.questions]);
  const counts = useMemo(
    () => paletteCounts(paperOrder, state.answers),
    [paperOrder, state.answers],
  );
  const sectionCounts = useMemo(
    () => sectionPaletteCounts(paper.sections, paper.questions, state.answers),
    [paper.sections, paper.questions, state.answers],
  );

  const submit = useMutation({
    mutationFn: async () => {
      // The question still on screen has cost time too; bank it before the last batch goes.
      state.bankOpen();
      // The last batch rides the submit: one request at the deadline, and a failed one keeps it for the retry.
      return state.finish(async (last) => {
        // A hung request is given up like one that never landed, so it is retried inside the grace.
        const abandon = new AbortController();
        const giveUp = setTimeout(() => abandon.abort(), SUBMIT_TIMEOUT_MS);
        try {
          return await api.me.submitAttempt(
            paper.attemptId,
            { tab, last: last ?? undefined },
            { signal: abandon.signal },
          );
        } finally {
          clearTimeout(giveUp);
        }
      });
    },
    retry: shouldRetrySubmit,
    retryDelay: submitRetryDelayMs,
    onError: () => {
      ending.current = false;
      state.resume();
    },
    onSuccess: async (submitted) => {
      // Marked stale, not refetched: the mobile tabs sit mounted under the paper, and every one would GET at the bell.
      void queryClient.invalidateQueries({ queryKey: catalogQueryKey, refetchType: 'none' });
      // The hall gives the screen back before the next one draws; `nagging` is already stood down.
      await focus.exit();
      onEnded({
        attemptId: submitted.attemptId,
        sections: sectionEffort(paper.sections, paper.questions, state.answers),
      });
    },
  });

  const end = () => {
    if (ending.current || state.takenOver) return;
    ending.current = true;
    submit.mutate();
  };

  const move = (to: string | null): void => {
    if (inert) return;
    state.open(to);
    setQuestionId(to);
  };

  const canOpen = (id: string): boolean =>
    !forwardOnly || mayOpenQuestion(order, current?.questionId ?? null, id);

  // Moving between sections is a save point: a batch left behind is a section's worth of answers.
  const openSection = (next: string) => {
    if (inert) return;
    state.bankOpen();
    const allowed = paper.sections.find((row) => row.id === next)?.durationSec;
    // Told, not asked: the server stamps when this clock started, so a reload cannot restart it.
    if (sectional && allowed !== null && allowed !== undefined) state.enterSection(next, allowed);
    void state.flush();
    setSectionId(next);
    move(null);
  };

  const endSection = () => {
    state.closeSection(sectionId, 0);
    const next = nextOpenSectionId(paper.sections, state.sections, sectionId);
    if (next) openSection(next);
    else end();
  };

  const nextQuestion = () => {
    move(nextQuestionId(order, current?.questionId ?? null, !forwardOnly));
  };

  // A flag asks for a second look, which a forward-only paper cannot grant — so it never takes one.
  const record = (next: AnswerIntent): void => {
    if (current && !inert)
      state.answer(current.questionId, forwardOnly ? { ...next, marked: false } : next);
  };

  // Null is "no clock of its own" and falls to the paper's; a section spent to 0 still counts, and closes.
  const sectionSec = sectional
    ? sectionLeftSec(section?.durationSec, state.sections[sectionId]?.openedAt, clock.serverNow)
    : null;
  const unanswered = counts[ANSWER_STATE.NOT_ANSWERED] + counts[ANSWER_STATE.NOT_VISITED];
  const markedForReview = counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED];
  // Never a trap: dismissing holds until the NEXT exit, so a browser that refuses does not lock them out.
  const nagging =
    !state.takenOver &&
    !submit.isSuccess &&
    !submit.isPending &&
    focus.isSupported &&
    !focus.isFullscreen &&
    focus.exits > 0 &&
    focus.exits > ignoringFullscreen;

  // This render's every move, read when a handler is CALLED — so no exposed handler carries a dep list to get wrong.
  const now = {
    canOpen,
    move,
    nextQuestion,
    record,
    openSection,
    end,
    expire: sectionSec === null ? end : endSection,
    sectionCounts,
    counts,
    focus,
  };
  const live = useRef(now);
  // Before any child's layout effect, so a handler called in the same commit is already this render's.
  useInsertionEffect(() => {
    live.current = now;
  });

  // Built once. Identity never changes, and every one of them is current because it reads through the ref.
  const on = useMemo(
    () => ({
      openQuestion: (id: string) => {
        if (live.current.canOpen(id)) live.current.move(id);
      },
      canOpen: (id: string) => live.current.canOpen(id),
      nextQuestion: () => live.current.nextQuestion(),
      chooseOption: (optionId: string) => live.current.record({ selectedOptionId: optionId }),
      bubbleAnswer: (optionId: string, fill: number) => {
        const filled = omrStateFor(fill);
        // A smudge is not an answer, so it must not pick the option either — only stop flagging it.
        if (filled === ANSWER_STATE.NOT_ANSWERED) return;
        live.current.record({
          selectedOptionId: optionId,
          marked: filled === ANSWER_STATE.ANSWERED_MARKED,
        });
        // A full bubble IS Save & Next — the gesture does what the button used to.
        if (filled === ANSWER_STATE.ANSWERED) live.current.nextQuestion();
      },
      markAndNext: () => {
        live.current.record({ marked: true });
        live.current.nextQuestion();
      },
      clearResponse: () => live.current.record({ selectedOptionId: null }),
      openSection: (id: string) => live.current.openSection(id),
      sectionCounts: (id: string) => live.current.sectionCounts[id] ?? live.current.counts,
      expire: () => live.current.expire(),
      retry: () => live.current.end(),
      cancel: () => setAsking(false),
      confirm: () => {
        setAsking(false);
        live.current.end();
      },
      enter: () => void live.current.focus.enter(),
      ignore: () => setIgnoringFullscreen(live.current.focus.exits),
    }),
    [],
  );

  const timer = useMemo<ExamTimerView>(
    () =>
      sectionSec === null
        ? { kind: TIMER_KIND.PAPER, clock, onExpire: on.expire }
        : { kind: TIMER_KIND.SECTION, key: sectionId, allowedSec: sectionSec, onExpire: on.expire },
    [sectionSec, clock, sectionId, on],
  );

  const submitView = useMemo<ExamSubmitView>(
    () => ({
      asking: asking && !state.takenOver,
      isPending: submit.isPending,
      failed: submit.isError,
      retry: on.retry,
      unanswered,
      markedForReview,
      ask,
      cancel: on.cancel,
      confirm: on.confirm,
    }),
    [
      asking,
      state.takenOver,
      submit.isPending,
      submit.isError,
      unanswered,
      markedForReview,
      ask,
      on,
    ],
  );

  const fullscreen = useMemo<ExamFullscreenView>(
    () => ({
      nagging,
      isFullscreen: focus.isFullscreen,
      isSupported: focus.isSupported,
      exits: focus.exits,
      enter: on.enter,
      ignore: on.ignore,
    }),
    [nagging, focus.isFullscreen, focus.isSupported, focus.exits, on],
  );

  const { answers, isSaving, hasUnsaved, hasUnsent, leave, takenOver, setAside } = state;
  return useMemo<ExamView>(
    () => ({
      title: title ?? 'Your test',
      watermark,
      languages: paper.languages,
      languageMode: paper.languageMode,
      testUi: paper.testUi,

      sections: paper.sections,
      sectionId,
      reachable,
      forwardOnly,

      questions: inSection,
      question: current,
      questionIndex: current ? inSection.indexOf(current) : -1,
      selectedOptionId: current ? (answers[current.questionId]?.selectedOptionId ?? null) : null,
      marked: isReviewState(current ? answers[current.questionId]?.state : undefined),
      answers,
      counts,
      sectionCounts: on.sectionCounts,

      timer,

      isSaving,
      hasUnsaved,
      hasUnsent,
      leave,
      takenOver,
      setAside,

      openQuestion: on.openQuestion,
      canOpen: on.canOpen,
      nextQuestion: on.nextQuestion,
      chooseOption: on.chooseOption,
      bubbleAnswer: on.bubbleAnswer,
      markAndNext: on.markAndNext,
      clearResponse: on.clearResponse,
      openSection: on.openSection,

      submit: submitView,
      fullscreen,
    }),
    [
      title,
      watermark,
      paper.languages,
      paper.languageMode,
      paper.testUi,
      paper.sections,
      sectionId,
      reachable,
      forwardOnly,
      inSection,
      current,
      answers,
      counts,
      timer,
      isSaving,
      hasUnsaved,
      hasUnsent,
      leave,
      takenOver,
      setAside,
      on,
      submitView,
      fullscreen,
    ],
  );
}
