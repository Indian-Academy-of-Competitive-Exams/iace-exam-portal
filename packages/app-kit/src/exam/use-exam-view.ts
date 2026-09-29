/**
 * The engine. It holds the sitting — where the candidate is, what they have
 * answered, when the clock ends, what a submit does — and hands a template the
 * finished view. What a sectional clock changes is which sections are open, and
 * that is read from the config rather than branched into a second screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { shouldRetrySubmit, submitRetryDelayMs } from '../autosave-policy';
import { type FullscreenHandle } from './focus-guard';
import { useAttemptState, type AnswerIntent, type AttemptStateDeps } from './use-attempt-state';
import { TIMER_KIND, type ExamTimerView, type ExamView } from './exam-view';

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
  const reachable = openSections(paper.sections, sectional, state.sections);
  // Drawn but inert until the server says which section is open: the one on screen may already be closed.
  const inert = sectional && !state.sectionsSeeded;

  // A reload must land where the sitting really is, not the paper's first section.
  if (sectional && reachable[0] !== undefined && reachable[0] !== sectionId) {
    setSectionId(reachable[0]);
  }

  const firstReachable = reachable[0];
  const { sectionsSeeded, sections: heldSections, enterSection } = state;
  // Stamps a section's clock the first time it is truly known to have never been opened.
  useEffect(() => {
    if (!sectional || !sectionsSeeded) return;
    if (firstReachable === undefined || heldSections[firstReachable] !== undefined) return;
    const allowed = paper.sections.find((row) => row.id === firstReachable)?.durationSec;
    if (allowed !== null && allowed !== undefined) enterSection(firstReachable, allowed);
  }, [sectional, sectionsSeeded, firstReachable, heldSections, paper.sections, enterSection]);

  const section = paper.sections.find((row) => row.id === sectionId);
  const inSection = paper.questions.filter((row) => row.baseConfigSectionId === sectionId);
  const order = inSection.map((row) => row.questionId);
  // A forward-only reload lands where the candidate had got to, not on a seat already left.
  const landing = forwardOnly ? Math.max(0, furthestSeat(order, state.answers)) : 0;
  const current = inSection.find((row) => row.questionId === questionId) ?? inSection[landing];
  const onScreen = current?.questionId;
  const { open } = state;
  // Landed on, not moved to, and only once the server has said where the sitting is: before, it may be a closed section.
  useEffect(() => {
    if (sectionsSeeded && onScreen !== undefined) open(onScreen);
  }, [sectionsSeeded, onScreen, open]);
  const counts = paletteCounts(
    paper.questions.map((row) => row.questionId),
    state.answers,
  );
  const sectionCounts = sectionPaletteCounts(paper.sections, paper.questions, state.answers);

  const submit = useMutation({
    mutationFn: async () => {
      // The question still on screen has cost time too; bank it before the last batch goes.
      state.bankOpen();
      // The last batch rides the submit: one request at the deadline, and a failed one keeps it for the retry.
      return state.finish((last) =>
        api.me.submitAttempt(paper.attemptId, { tab, last: last ?? undefined }),
      );
    },
    retry: shouldRetrySubmit,
    retryDelay: submitRetryDelayMs,
    onError: () => {
      ending.current = false;
    },
    onSuccess: async (submitted) => {
      // The sat test moves from Open now to Done; nothing waits on the refetch.
      void queryClient.invalidateQueries({ queryKey: catalogQueryKey });
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
  const timer: ExamTimerView =
    sectionSec === null
      ? { kind: TIMER_KIND.PAPER, clock, onExpire: end }
      : { kind: TIMER_KIND.SECTION, key: sectionId, allowedSec: sectionSec, onExpire: endSection };

  const unanswered = counts[ANSWER_STATE.NOT_ANSWERED] + counts[ANSWER_STATE.NOT_VISITED];
  // Never a trap: dismissing holds until the NEXT exit, so a browser that refuses does not lock them out.
  const nagging =
    !state.takenOver &&
    !submit.isSuccess &&
    !submit.isPending &&
    focus.isSupported &&
    !focus.isFullscreen &&
    focus.exits > 0 &&
    focus.exits > ignoringFullscreen;

  return {
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
    selectedOptionId: current
      ? (state.answers[current.questionId]?.selectedOptionId ?? null)
      : null,
    marked: isReviewState(current ? state.answers[current.questionId]?.state : undefined),
    answers: state.answers,
    counts,
    sectionCounts: (id) => sectionCounts[id] ?? counts,

    timer,

    isSaving: state.isSaving,
    hasUnsaved: state.hasUnsaved,
    hasUnsent: state.hasUnsent,
    leave: state.leave,
    takenOver: state.takenOver,
    setAside: state.setAside,

    openQuestion: (id) => {
      if (canOpen(id)) move(id);
    },
    canOpen,
    nextQuestion,
    chooseOption: (optionId) => record({ selectedOptionId: optionId }),
    bubbleAnswer: (optionId, fill) => {
      const state = omrStateFor(fill);
      // A smudge is not an answer, so it must not pick the option either — only stop flagging it.
      if (state === ANSWER_STATE.NOT_ANSWERED) return;
      record({ selectedOptionId: optionId, marked: state === ANSWER_STATE.ANSWERED_MARKED });
      // A full bubble IS Save & Next — the gesture does what the button used to.
      if (state === ANSWER_STATE.ANSWERED) nextQuestion();
    },
    markAndNext: () => {
      record({ marked: true });
      nextQuestion();
    },
    clearResponse: () => record({ selectedOptionId: null }),
    openSection,

    submit: {
      asking: asking && !state.takenOver,
      isPending: submit.isPending,
      /** True once every retry is spent: the paper could not go in, and the screen must say so. */
      failed: submit.isError,
      retry: end,
      unanswered,
      markedForReview: counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED],
      ask,
      cancel: () => setAsking(false),
      confirm: () => {
        setAsking(false);
        end();
      },
    },

    fullscreen: {
      nagging,
      isFullscreen: focus.isFullscreen,
      isSupported: focus.isSupported,
      exits: focus.exits,
      enter: () => void focus.enter(),
      ignore: () => setIgnoringFullscreen(focus.exits),
    },
  };
}
