/**
 * The exam hall, ported from the web's `exam.tsx`: it starts the sitting, hands
 * the engine the paper and lets the skin draw it. The skin mounts on arrival,
 * before any attempt exists, so the question renderer loads alongside the
 * network rather than on the student's clock; the engine reports its view up.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppException, ErrorCodes, type ExamQuestion, type LiveAttempt } from '@iace/contracts';
import { useExamView, type EndedSitting, type ExamSitting, type ExamView } from '@iace/app-kit';
import { api } from '../../src/lib/api';
import {
  attemptPaperQueryKey,
  CATALOG_QUERY_KEY,
  EXAM_LANGUAGES_PARAM,
  startedAttemptQueryKey,
  STORAGE_KEYS,
} from '../../src/lib/constants';
import { examLanguagesFrom } from '../../src/lib/exam-routes';
import { deviceTab, sittingStorage } from '../../src/lib/sitting-store';
import { DETAIL_ROUTES, ROUTES } from '../../src/lib/nav';
import { endedSittingQuery } from '../../src/lib/queries';
import { useAuth } from '../../src/providers/auth';
import { appStateSource, useAppFocus } from '../../src/components/exam/use-app-focus';
import { ExamSkin } from '../../src/components/exam/exam-skin';
import { Button } from '../../src/components/ui/button';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';

/** Stable identity: a `[]` literal at the call site would re-run the preload memo on every render. */
const NO_QUESTIONS: readonly ExamQuestion[] = [];

export default function ExamScreen() {
  const { testId = '', [EXAM_LANGUAGES_PARAM]: languagesParam } = useLocalSearchParams<{
    testId: string;
    [EXAM_LANGUAGES_PARAM]?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { identity: student } = useAuth();
  const [view, setView] = useState<ExamView | null>(null);
  // Read once per visit: a sync SQLite read on every render would be paid on every tap.
  const [tab] = useState(deviceTab);
  // Bumped by Continue here, so the engine mounts fresh: a new queue read, and saving no longer stopped.
  const [reclaims, setReclaims] = useState(0);
  // The sitting Continue here names, so one handed in elsewhere is never restarted as a fresh paper.
  const [resume, setResume] = useState<string>();

  const attempt = useQuery({
    queryKey: startedAttemptQueryKey(testId),
    queryFn: () => {
      const languages = examLanguagesFrom(languagesParam);
      // None survived the URL: the server picks, as it does for a web start with no choice made.
      return api.me.startAttempt(testId, {
        languages: languages.length > 0 ? languages : undefined,
        tab,
        resume,
      });
    },
    enabled: testId !== '',
    // The sitting is started once; a refetch would be a second start, which the server resumes.
    staleTime: Infinity,
    retry: false,
  });

  const attemptId = attempt.data?.id ?? '';
  const paper = useQuery({
    queryKey: attemptPaperQueryKey(attemptId),
    // Stamped where the payload LANDS, never in a render: that instant is the clock's anchor.
    queryFn: async () => ({ paper: await api.me.attemptPaper(attemptId), arrivedAt: Date.now() }),
    enabled: attemptId !== '',
    staleTime: Infinity,
  });

  const onEnded = useCallback(
    (ended: EndedSitting) => {
      queryClient.setQueryData(endedSittingQuery(ended.attemptId).queryKey, ended);
      // `replace`: Back must never re-enter a paper that has been handed in.
      router.replace(DETAIL_ROUTES.SUBMITTED(ended.attemptId));
    },
    [queryClient, router],
  );

  // The one intended second start: removing the cached start while mounted refetches it with this tab.
  const continueHere = useCallback(() => {
    setResume(queryClient.getQueryData<LiveAttempt>(startedAttemptQueryKey(testId))?.id);
    forgetSitting(queryClient, testId);
    setView(null);
    setReclaims((count) => count + 1);
  }, [queryClient, testId]);

  // On unmount, never in onEnded: a still-mounted query rebuilds what was removed, and that fetch IS a second start.
  useEffect(() => () => forgetSitting(queryClient, testId), [queryClient, testId]);

  // Android's Back would drop a running paper; in a sitting the only way out is handing it in.
  useEffect(() => {
    if (!view || view.takenOver) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      view.submit.ask();
      return true;
    });
    return () => subscription.remove();
  }, [view]);

  if (attempt.isError) {
    const { error } = attempt;
    if (resume && AppException.is(error) && error.code === ErrorCodes.SITTING_ENDED) {
      return <Redirect href={DETAIL_ROUTES.SUBMITTED(resume)} />;
    }
    return (
      <View className="flex-1 justify-center bg-background p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This test could not be started"
          hint="Check when it opens on your tests."
          action={<Button onPress={() => router.dismissTo(ROUTES.TESTS)}>Go to your tests</Button>}
        />
      </View>
    );
  }

  if (paper.isError) {
    return (
      <View className="flex-1 justify-center bg-background p-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Your paper did not load"
          hint="The clock is running on the server."
          onRetry={paper.refetch}
        />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <ExamSkin view={view} paperQuestions={paper.data?.paper.questions ?? NO_QUESTIONS} />
      {paper.data && attempt.data ? (
        <SittingEngine
          key={reclaims}
          paper={paper.data.paper}
          arrivedAt={paper.data.arrivedAt}
          title={attempt.data.testTitle}
          // The one thing on the paper that leads back to a person: there is no enrolment number.
          watermark={student?.mobile ?? ''}
          onEnded={onEnded}
          onView={setView}
          tab={tab}
        />
      ) : null}
      {view?.takenOver ? (
        // Over the skin, not instead of it: the question WebView stays warm for the reclaim.
        <View className="absolute inset-0 justify-center bg-background p-6">
          <EmptyState
            kind={EMPTY_STATE_KINDS.REFUSED}
            title="This paper is being answered somewhere else"
            /* ui-copy-ok: consequence — continuing here is what stops the other one */
            hint="Your answers are saved. Continuing here stops the other tab or device."
            action={<Button onPress={continueHere}>Continue here</Button>}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A cached start is the attempt as it WAS: a handed-in one would draw a paper where nothing saves. */
function forgetSitting(queryClient: QueryClient, testId: string): void {
  const started = queryClient.getQueryData<LiveAttempt>(startedAttemptQueryKey(testId));
  if (started) {
    queryClient.removeQueries({ queryKey: attemptPaperQueryKey(started.id), exact: true });
  }
  queryClient.removeQueries({ queryKey: startedAttemptQueryKey(testId), exact: true });
}

/** Draws nothing: it runs the engine and hands each view up, so the skin never waits to mount. */
const SittingEngine = memo(function SittingEngine({
  onView,
  tab,
  ...sitting
}: Readonly<ExamSitting & { onView: (view: ExamView) => void; tab: string }>) {
  const focus = useAppFocus(appStateSource);
  const view = useExamView(sitting, {
    api,
    focus,
    catalogQueryKey: CATALOG_QUERY_KEY,
    tab,
    answerQueue: { storage: sittingStorage, keyPrefix: STORAGE_KEYS.QUEUED_ANSWERS },
  });

  // Before paint, so the skin never shows a view the engine has already moved past.
  useLayoutEffect(() => {
    onView(view);
  });

  return null;
});
