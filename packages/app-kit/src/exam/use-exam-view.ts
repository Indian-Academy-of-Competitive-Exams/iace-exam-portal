/**
 * The engine. It holds the sitting — where the candidate is, what they have
 * answered, when the clock ends, what a submit does — and hands a template the
 * finished view. What a sectional clock changes is which sections are open, and
 * that is read from the config rather than branched into a second screen.
 */
import { useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ANSWER_STATE,
  omrStateFor,
  nextOpenSectionId,
  nextQuestionId,
  openSections,
  paletteCounts,
  sectionEffort,
  sectionPaletteCounts,
  TIMER_TEMPLATE,
  type ExamClock,
  type ExamPaper,
  type SectionEffort,
} from '@iace/contracts';
import { shouldRetrySubmit, submitRetryDelayMs } from '../autosave-policy';
import { type FullscreenHandle } from './focus-guard';
import {
  isTakenOver,
  useAttemptState,
  type AnswerIntent,
  type AttemptStateDeps,
} from './use-attempt-state';
import type { ExamView } from './exam-view';

/** What the engine cannot know: the autosave's own deps, whose cache key, and how this platform reports focus. */
export interface ExamEngineDeps extends AttemptStateDeps {
  focus: FullscreenHandle;
  catalogQueryKey: QueryKey;
}

/** What the sitting knows about itself the moment it ends, before anything has been marked. */
export interface EndedSitting {
  attemptId: string;
  answered: number;
  unanswered: number;
  markedForReview: number;
  total: number;
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

const isMarked = (state: string | undefined): boolean =>
  state === ANSWER_STATE.MARKED_REVIEW || state === ANSWER_STATE.ANSWERED_MARKED;

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
  const clock: ExamClock = { endsAt: paper.endsAt, serverNow: paper.serverNow, arrivedAt };

  const sectional = paper.timerTemplate !== TIMER_TEMPLATE.COMPOSITE_FREE;
  const reachable = openSections(paper.sections, sectional, state.sections);
  const section = paper.sections.find((row) => row.id === sectionId);
  const inSection = paper.questions.filter((row) => row.baseConfigSectionId === sectionId);
  const current = inSection.find((row) => row.questionId === questionId) ?? inSection[0];
  const counts = paletteCounts(
    paper.questions.map((row) => row.questionId),
    state.answers,
  );
  // One tally, read live by the section bar and handed on unchanged when the paper goes in.
  const effort = sectionEffort(paper.sections, paper.questions, state.answers);
  const sectionCounts = sectionPaletteCounts(paper.sections, paper.questions, state.answers);

  const submit = useMutation({
    mutationFn: async () => {
      // The question still on screen has cost time too; bank it before the last save goes.
      state.bankOpen();
      await state.flush();
      return api.me.submitAttempt(paper.attemptId, { tab });
    },
    retry: shouldRetrySubmit,
    retryDelay: submitRetryDelayMs,
    onError: (error) => {
      if (isTakenOver(error)) state.standDown();
    },
    onSuccess: async (submitted) => {
      // The sat test moves from Open now to Done, and the server has already dropped its own copy.
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      // The hall gives the screen back before the next one draws; `nagging` is already stood down.
      await focus.exit();
      onEnded({
        attemptId: submitted.attemptId,
        sections: effort,
        answered: counts[ANSWER_STATE.ANSWERED] + counts[ANSWER_STATE.ANSWERED_MARKED],
        unanswered: counts[ANSWER_STATE.NOT_ANSWERED] + counts[ANSWER_STATE.NOT_VISITED],
        markedForReview: counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED],
        total: paper.questions.length,
      });
    },
  });

  const end = () => {
    if (!submit.isPending && !submit.isSuccess && !state.takenOver) submit.mutate();
  };

  const move = (to: string | null): void => {
    state.open(to);
    setQuestionId(to);
  };

  // Moving between sections is a save point: a batch left behind is a section's worth of answers.
  const openSection = (next: string) => {
    state.bankOpen();
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
    move(
      nextQuestionId(
        inSection.map((row) => row.questionId),
        current?.questionId ?? null,
      ),
    );
  };

  const record = (next: AnswerIntent): void => {
    if (current) state.answer(current.questionId, next);
  };

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
    effort,
    sectionId,
    section,
    reachable,
    sectional,

    questions: inSection,
    question: current,
    questionIndex: current ? inSection.indexOf(current) : -1,
    selectedOptionId: current
      ? (state.answers[current.questionId]?.selectedOptionId ?? null)
      : null,
    marked: isMarked(current ? state.answers[current.questionId]?.state : undefined),
    answers: state.answers,
    counts,
    sectionCounts,

    clock,
    sectionSec: sectional ? (section?.durationSec ?? null) : null,

    isSaving: state.isSaving,
    hasUnsaved: state.hasUnsaved,
    takenOver: state.takenOver,

    openQuestion: move,
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
    endSection,
    outOfTime: end,

    submit: {
      asking: asking && !state.takenOver,
      isPending: submit.isPending,
      unanswered,
      markedForReview: counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED],
      ask: () => setAsking(true),
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
