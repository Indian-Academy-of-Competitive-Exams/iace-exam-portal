import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  authSessionResponseSchema,
  deviceSessionSchema,
  type AuthSessionResponse,
  type DeviceSession,
} from '../auth';
import {
  DOCUMENT_FILE_FIELD,
  ME_ROUTES,
  meSchema,
  type ChangePinInput,
  type DocumentKind,
  type Me,
  type UpdateMeInput,
  type UploadFile,
} from '../me';
import {
  SAVED_ROUTES,
  bookmarkedInAttemptSchema,
  savedQuestionSchema,
  savedFacetsSchema,
  type BookmarkQuestionInput,
  type BookmarkedInAttempt,
  type SavedListQueryInput,
  type SavedQuestion,
  type SavedFacets,
} from '../saved';
import {
  ME_ATTEMPT_ROUTES,
  examBriefSchema,
  examPaperSchema,
  performanceTrendSchema,
  scoreCardSchema,
  solutionReportSchema,
  attemptSaveAckSchema,
  liveAttemptSchema,
  liveAttemptStateSchema,
  submittedAttemptSchema,
  type AttemptSaveAck,
  type ExamBrief,
  type ExamPaper,
  type LiveAttempt,
  type PerformanceTrend,
  type ScoreCard,
  type SolutionReport,
  type SaveAttemptStateInput,
  type SubmitAttemptInput,
  type StartAttemptInput,
  type SubmittedAttempt,
  type LiveAttemptState,
} from '../attempts';
import {
  OVERVIEW_ROUTES,
  PERFORMANCE_ROUTES,
  performanceReportSchema,
  questionReportSchema,
  satSeriesSchema,
  studentOverviewSchema,
  testCalendarSchema,
  type PerformanceReport,
  type QuestionReport,
  type PerformanceReportQueryInput,
  type SatSeries,
  type StudentOverview,
  type TestCalendar,
} from '../stats';
import {
  LEADERBOARD_ROUTES,
  leaderboardSchema,
  type Leaderboard,
  type LeaderboardQueryInput,
} from '../leaderboard';
import {
  notificationSchema,
  type Notification,
  type NotificationListQueryInput,
  pushConfigSchema,
  type PushConfig,
  type PushDeviceInput,
  type PushSubscriptionInput,
  type DropPushDeviceInput,
  type DropPushSubscriptionInput,
  studentCatalogSchema,
  type StudentCatalog,
} from '../access';
import { queryString, type ApiCore } from './core';

/** Admin-only. A student token gets 403 from every one of these. */
/** The signed-in student's own account. No ids — the token is the subject. */
export function meClient(core: ApiCore) {
  const { get, write, list } = core;

  return {
    profile: (): Promise<Me> => get(ME_ROUTES.profile, meSchema),

    update: (input: UpdateMeInput): Promise<Me> =>
      write('PATCH', ME_ROUTES.update, meSchema, input),

    /** Returns a FRESH session — the caller must store these tokens. */
    /** A photo or an identity document. Returns the refreshed profile. */
    uploadDocument: (kind: DocumentKind, file: UploadFile): Promise<Me> => {
      const form = new FormData();
      // React Native passes a { uri, name, type } descriptor where a browser passes a File.
      form.append(DOCUMENT_FILE_FIELD, file as Blob);
      return write('POST', ME_ROUTES.document(kind), meSchema, form);
    },

    changePin: (input: ChangePinInput): Promise<AuthSessionResponse> =>
      write('POST', ME_ROUTES.changePin, authSessionResponseSchema, input),

    /** Where this account is signed in, newest activity first; the asking device is marked. */
    sessions: (): Promise<DeviceSession[]> => get(ME_ROUTES.sessions, deviceSessionSchema.array()),

    /** Signs another device out. Refused for the device asking — use logout for that. */
    signOutSession: (id: string): Promise<NoContent> =>
      write('DELETE', ME_ROUTES.session(id), noContentSchema),

    /** Every series this student reaches, with what is open right now. */
    catalog: (): Promise<StudentCatalog> => get(ME_ROUTES.catalog, studentCatalogSchema),

    /** The bell, newest first. `meta.total` under `unreadOnly` is the count the header shows. */
    notifications: (query: NotificationListQueryInput = {}): Promise<Paginated<Notification>> =>
      list(ME_ROUTES.notifications, query, notificationSchema),

    readNotification: (id: string): Promise<Notification> =>
      write('PATCH', ME_ROUTES.readNotification(id), notificationSchema),

    /** The key this browser subscribes to push with. */
    pushConfig: (): Promise<PushConfig> => get(ME_ROUTES.pushSubscription, pushConfigSchema),

    subscribeToPush: (input: PushSubscriptionInput): Promise<NoContent> =>
      write('POST', ME_ROUTES.pushSubscription, noContentSchema, input),

    unsubscribeFromPush: (input: DropPushSubscriptionInput): Promise<NoContent> =>
      write('DELETE', ME_ROUTES.pushSubscription, noContentSchema, input),

    /** Idempotent: the same token registering again is the same row, moved to whoever is signed in. */
    registerPushDevice: (input: PushDeviceInput): Promise<NoContent> =>
      write('POST', ME_ROUTES.pushDevice, noContentSchema, input),

    dropPushDevice: (input: DropPushDeviceInput): Promise<NoContent> =>
      write('DELETE', ME_ROUTES.pushDevice, noContentSchema, input),

    /** What the student reads before the clock starts. */
    testBrief: (testId: string): Promise<ExamBrief> =>
      get(ME_ATTEMPT_ROUTES.brief(testId), examBriefSchema),

    /** Idempotent: a second start while one is running resumes it, clock and all. */
    startAttempt: (testId: string, input: StartAttemptInput = {}): Promise<LiveAttempt> =>
      write('POST', ME_ATTEMPT_ROUTES.start(testId), liveAttemptSchema, input),

    /** The paper as a candidate sees it — it carries no answer. */
    attemptPaper: (attemptId: string): Promise<ExamPaper> =>
      get(ME_ATTEMPT_ROUTES.paper(attemptId), examPaperSchema),

    /** The autosave. Batches what changed since the last one; the server merges and decides. */
    saveAttemptState: (attemptId: string, input: SaveAttemptStateInput): Promise<AttemptSaveAck> =>
      write('PATCH', ME_ATTEMPT_ROUTES.state(attemptId), attemptSaveAckSchema, input),

    /** What the server is holding, so a reloaded tab can seed its answers instead of starting blank. */
    attemptState: (attemptId: string): Promise<LiveAttemptState> =>
      get(ME_ATTEMPT_ROUTES.state(attemptId), liveAttemptStateSchema),

    /** Ends it. A second call reports the first one's outcome rather than refusing. */
    submitAttempt: (attemptId: string, input: SubmitAttemptInput = {}): Promise<SubmittedAttempt> =>
      write('POST', ME_ATTEMPT_ROUTES.submit(attemptId), submittedAttemptSchema, input),

    /** Marks, standing and their own answers. Refused until the paper has been marked. */
    scoreCard: (attemptId: string): Promise<ScoreCard> =>
      get(ME_ATTEMPT_ROUTES.scoreCard(attemptId), scoreCardSchema),

    /** The worked solutions. Refused until the paper has been marked. */
    solutions: (attemptId: string): Promise<SolutionReport> =>
      get(ME_ATTEMPT_ROUTES.solutions(attemptId), solutionReportSchema),

    /** Their paper question by question, beside the cohort's. The key rides the solution gate. */
    questionReport: (attemptId: string): Promise<QuestionReport> =>
      get(ME_ATTEMPT_ROUTES.questionReport(attemptId), questionReportSchema),

    /** Every test this student has sat, oldest first. */
    performance: (): Promise<PerformanceTrend> =>
      get(ME_ATTEMPT_ROUTES.performance, performanceTrendSchema),

    /** Sitting counts by institute day, for the calendar the trend's twenty cannot fill. */
    testDays: (): Promise<TestCalendar> => get(ME_ATTEMPT_ROUTES.testDays, testCalendarSchema),

    /** The cutoff-free metric set for one sitting, one paper, one series or the whole career. */
    performanceReport: (query: PerformanceReportQueryInput): Promise<PerformanceReport> =>
      get(`${PERFORMANCE_ROUTES.me}${queryString({ ...query })}`, performanceReportSchema),

    /** Every series they have sat a test in — the SERIES scope has nothing else to offer. */
    performanceSeries: (): Promise<SatSeries[]> =>
      get(PERFORMANCE_ROUTES.mySeries, satSeriesSchema.array()),

    /** Their whole career off the two rollup tables: standing, disposition and subjects. */
    overview: (): Promise<StudentOverview> => get(OVERVIEW_ROUTES.me, studentOverviewSchema),

    /** The board, for a signed-in reader only. Never call this from an unauthenticated screen. */
    leaderboard: (query: LeaderboardQueryInput): Promise<Leaderboard> =>
      get(`${LEADERBOARD_ROUTES.me}${queryString({ ...query })}`, leaderboardSchema),

    /** Everything they starred, newest first. */
    savedQuestions: (query: SavedListQueryInput): Promise<Paginated<SavedQuestion>> =>
      list(SAVED_ROUTES.list, query, savedQuestionSchema),

    /** Idempotent: starring a question already starred returns the row it already had. */
    bookmarkQuestion: (input: BookmarkQuestionInput): Promise<SavedQuestion> =>
      write('POST', SAVED_ROUTES.bookmark, savedQuestionSchema, input),

    /** Every choice both saved-list filters can offer, off their own set — never the whole catalog. */
    savedFacets: (): Promise<SavedFacets> => get(SAVED_ROUTES.facets, savedFacetsSchema),

    removeSavedQuestion: (id: string): Promise<NoContent> =>
      write('DELETE', SAVED_ROUTES.remove(id), noContentSchema),

    /** Which questions of one sitting are already starred — what the review draws its stars from. */
    bookmarksInAttempt: (attemptId: string): Promise<BookmarkedInAttempt> =>
      get(SAVED_ROUTES.inAttempt(attemptId), bookmarkedInAttemptSchema),
  };
}
