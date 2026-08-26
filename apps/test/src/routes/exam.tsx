/**
 * The exam hall. One screen for both timer templates: what a sectional clock changes is
 * which sections are open, and that is read from the config rather than branched into a
 * second screen. Local state draws it; the server keeps the clock and the answers.
 */
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Eraser, Send } from 'lucide-react';
import {
  ANSWER_STATE,
  openSections,
  TEST_BUCKET,
  paletteCounts,
  TIMER_TEMPLATE,
  type ExamClock,
  type ExamPaper,
  type LanguageCode,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  LoadingState,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Watermark,
  cn,
  plural,
} from '@iace/ui';
import { useFullscreen } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { TAB_KEY } from './tests';
import { useAttemptState, type AnswerIntent } from '../lib/use-attempt-state';
import { ExamTimer } from '../components/exam/exam-timer';
import { QuestionBody } from '../components/exam/question-body';
import { QuestionPalette } from '../components/exam/question-palette';
import { SectionTimer } from '../components/exam/section-timer';

interface BeganWith {
  languages?: LanguageCode[];
}

export function ExamPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const { identity: student } = useAuth();
  const began = (useLocation().state ?? {}) as BeganWith;

  const attempt = useQuery({
    queryKey: ['me', 'attempt', testId],
    queryFn: () => api.me.startAttempt(testId, { languages: began.languages }),
    enabled: testId !== '',
    // The sitting is started once; a refetch would be a second start, which the server resumes.
    staleTime: Infinity,
    retry: false,
  });

  const attemptId = attempt.data?.id ?? '';
  const paper = useQuery({
    queryKey: ['me', 'attempt-paper', attemptId],
    // Stamped where the payload LANDS, never in a render: that instant is the clock's anchor.
    queryFn: async () => ({ paper: await api.me.attemptPaper(attemptId), arrivedAt: Date.now() }),
    enabled: attemptId !== '',
    staleTime: Infinity,
  });

  if (attempt.isError) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          This test cannot be started right now. Go back to your tests and check when it opens.
        </Alert>
      </div>
    );
  }

  if (!paper.data || !attempt.data) {
    return <LoadingState>Opening your paper</LoadingState>;
  }

  return (
    <ExamHall
      paper={paper.data.paper}
      arrivedAt={paper.data.arrivedAt}
      title={attempt.data.testTitle}
      // The one thing on the paper that leads back to a person: there is no enrolment number.
      watermark={student?.mobile ?? ''}
      // Onto the tab now holding it: landing on Open now would look like the test had vanished.
      onEnded={() => navigate(`${ROUTES.TESTS}?${TAB_KEY}=${TEST_BUCKET.DONE}`, { replace: true })}
    />
  );
}

function ExamHall({
  paper,
  arrivedAt,
  title,
  watermark,
  onEnded,
}: Readonly<{
  paper: ExamPaper;
  arrivedAt: number;
  title: string | null;
  watermark: string;
  onEnded: () => void;
}>) {
  const queryClient = useQueryClient();
  const fullscreen = useFullscreen();
  const [ignoringFullscreen, setIgnoringFullscreen] = useState(0);
  const state = useAttemptState(paper.attemptId);
  const [sectionId, setSectionId] = useState(paper.sections[0]?.id ?? '');
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const clock: ExamClock = { endsAt: paper.endsAt, serverNow: paper.serverNow, arrivedAt };

  const sectional = paper.timerTemplate !== TIMER_TEMPLATE.COMPOSITE_FREE;
  const reachable = openSections(paper.sections, sectional, state.sections);
  const currentSection = paper.sections.find((section) => section.id === sectionId);
  const inSection = paper.questions.filter((row) => row.baseConfigSectionId === sectionId);
  const current = inSection.find((row) => row.questionId === questionId) ?? inSection[0];
  const counts = paletteCounts(
    paper.questions.map((row) => row.questionId),
    state.answers,
  );

  const submit = useMutation({
    mutationFn: async () => {
      await state.flush();
      return api.me.submitAttempt(paper.attemptId);
    },
    onSuccess: async () => {
      // The sat test moves from Open now to Done, and the server has already dropped its own copy.
      await queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      onEnded();
    },
  });

  const end = () => {
    if (!submit.isPending && !submit.isSuccess) submit.mutate();
  };

  // Moving between sections is a save point: a batch left behind is a section's worth of answers.
  const openSection = (next: string) => {
    void state.flush();
    setSectionId(next);
    move(null);
  };

  /** A section whose clock ended is shut for good, and the next open one takes over. */
  const endSection = () => {
    state.closeSection(sectionId, 0);
    const next = paper.sections.find(
      (section) => section.id !== sectionId && !state.sections[section.id]?.closed,
    );
    if (next) openSection(next.id);
    else end();
  };

  const nextQuestion = () => {
    const seat = inSection.findIndex((row) => row.questionId === current?.questionId);
    move(inSection[seat + 1]?.questionId ?? inSection[0]?.questionId ?? null);
  };

  const record = (next: AnswerIntent): void => {
    if (current) state.answer(current.questionId, next);
  };

  const move = (to: string | null): void => {
    state.open(to);
    setQuestionId(to);
  };

  const unanswered = counts[ANSWER_STATE.NOT_ANSWERED] + counts[ANSWER_STATE.NOT_VISITED];
  // Never a trap: dismissing holds until the NEXT exit, so a browser that refuses does not lock them out.
  const nagging =
    fullscreen.isSupported &&
    !fullscreen.isFullscreen &&
    fullscreen.exits > 0 &&
    fullscreen.exits > ignoringFullscreen;

  return (
    <div className="relative flex h-dvh flex-col bg-surface">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title ?? 'Your test'}
        </h1>
        <div className="flex items-center gap-3">
          {state.hasUnsaved ? <Badge variant="warning">Not saved yet</Badge> : null}
          {state.isSaving ? <Spinner size="sm" label="Saving" /> : null}
          <ExamTimer clock={clock} onExpire={end} />
        </div>
      </header>

      <Tabs value={sectionId} onValueChange={openSection} className="min-h-0 flex-1">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <TabsList>
            {paper.sections.map((section) => (
              <TabsTrigger
                key={section.id}
                value={section.id}
                disabled={!reachable.includes(section.id)}
              >
                {section.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {sectional && currentSection?.durationSec ? (
            <SectionTimer
              key={currentSection.id}
              allowedSec={currentSection.durationSec}
              onExpire={endSection}
            />
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
            {watermark ? <Watermark text={watermark} /> : null}
            {current ? (
              <QuestionBody
                question={current}
                index={inSection.indexOf(current)}
                languages={paper.languages}
                languageMode={paper.languageMode}
                selectedOptionId={state.answers[current.questionId]?.selectedOptionId ?? null}
                onSelect={(optionId) => record({ selectedOptionId: optionId })}
              />
            ) : (
              <Alert variant="info">This section is closed.</Alert>
            )}
          </div>

          <aside className="shrink-0 border-t border-border p-4 lg:w-72 lg:border-l lg:border-t-0">
            <QuestionPalette
              questionIds={inSection.map((row) => row.questionId)}
              answers={state.answers}
              currentId={current?.questionId ?? null}
              counts={counts}
              onOpen={move}
            />
          </aside>
        </div>
      </Tabs>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            record({ marked: true });
            nextQuestion();
          }}
        >
          <Flag aria-hidden />
          Mark for review &amp; next
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => record({ selectedOptionId: null })}
        >
          <Eraser aria-hidden />
          Clear response
        </Button>
        <Button type="button" size="sm" onClick={nextQuestion}>
          Save &amp; next
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('ml-auto')}
          loading={submit.isPending}
          onClick={() => setAsking(true)}
        >
          <Send aria-hidden />
          Submit
        </Button>
      </footer>

      {nagging ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface/95 p-6">
          <div className="flex max-w-md flex-col gap-4">
            <Alert variant="danger">
              {`${leftFullScreen(fullscreen.exits)} Your paper is still running and the clock has not stopped. Leaving full screen is recorded on this sitting.`}
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void fullscreen.enter()}>
                Return to full screen
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIgnoringFullscreen(fullscreen.exits)}
              >
                Carry on without it
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        title="Submit this test?"
        description={`${plural(unanswered, 'question')} unanswered and ${counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED]} marked for review. Once submitted the paper closes and nothing more can be changed.`}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={() => {
          setAsking(false);
          end();
        }}
      />
    </div>
  );
}

/** Said once without a count, because "1 times" is how a screen tells a student it is a machine. */
function leftFullScreen(exits: number): string {
  return exits > 1 ? `You left full screen ${exits} times.` : 'You left full screen.';
}
