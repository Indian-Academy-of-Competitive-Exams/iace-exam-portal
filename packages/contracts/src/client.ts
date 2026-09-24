import { type ZodType } from 'zod';
import {
  AppException,
  ErrorCodes,
  apiFailureSchema,
  apiSuccessSchema,
  errorCodeForStatus,
  noContentSchema,
  REQUEST_ID_HEADER,
  type ApiSuccess,
  type NoContent,
  type Paginated,
  type PaginationQueryInput,
} from './envelope';
import {
  ADMIN_AUTHORING_ROUTES,
  authoringDuplicateSchema,
  authoringReleaseSchema,
  authoringSaveResultSchema,
  authoringStatsSchema,
  type AuthoringCreateInput,
  type AuthoringHistoryQueryInput,
  type AuthoringRelease,
  type AuthoringDuplicate,
  type AuthoringSaveResult,
  type AuthoringStats,
} from './authoring';
import {
  ADMIN_AUDIT_ROUTES,
  importLogSchema,
  rowActionSchema,
  type ImportLogSummary,
  type RowAction,
  type RowActionListQueryInput,
} from './audit';
import {
  AUTH_ROUTES,
  authSessionResponseSchema,
  authIdentitySchema,
  authTokensSchema,
  deviceSessionSchema,
  otpRequestResponseSchema,
  pinSetupTicketSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type DeviceSession,
  type OtpRequestResponse,
  type PinSetupTicket,
  type RequestAdminOtpInput,
  type RequestStudentOtpInput,
  type SetStudentPinInput,
  type StudentLoginInput,
  type VerifyAdminOtpInput,
  type VerifyStudentOtpInput,
} from './auth';
import {
  ADMIN_ADMIN_ROUTES,
  ADMIN_FEATURE_ROUTES,
  adminSchema,
  featureSchema,
  type Admin,
  type AdminListQueryInput,
  type CreateAdminInput,
  type Feature,
  type PermissionGrantBody,
  type PermissionGrantInput,
  type UpdateAdminBody,
} from './admins';
import { CSV_SEPARATOR } from './common';
import { ADMIN_DASHBOARD_ROUTES, dashboardSchema, type Dashboard } from './dashboard';
import {
  DOCUMENT_FILE_FIELD,
  ME_ROUTES,
  erasureReceiptSchema,
  type ErasureReceipt,
  meSchema,
  type ChangePinInput,
  type DocumentKind,
  type Me,
  type UpdateMeInput,
  type UploadFile,
} from './me';
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
} from './saved';
import {
  ADMIN_BRANCH_ROUTES,
  branchSchema,
  type Branch,
  type BranchListQueryInput,
  type CreateBranchInput,
  type UpdateBranchInput,
} from './branches';
import {
  ADMIN_GRANT_ROUTES,
  ADMIN_STUDENT_SERIES_ROUTES,
  ADMIN_PROGRAM_ROUTES,
  ADMIN_SERIES_ROUTES,
  EVENT_ROUTES,
  seriesBranchSchema,
  eventSchema,
  eventCandidateSchema,
  programCatalogSchema,
  studentGrantRowSchema,
  studentSeriesAccessSchema,
  testSeriesDetailSchema,
  testSeriesSummarySchema,
  type SeriesBranch,
  type AddEventCandidatesInput,
  type CreateEventInput,
  type CreateProgramInput,
  type CreateTestSeriesInput,
  type Event,
  type EventCandidate,
  type EventListQueryInput,
  type GrantSeriesInput,
  type Program,
  type ProgramListQueryInput,
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
  type StudentGrantRow,
  type StudentSeriesAccess,
  type TestSeriesListQueryInput,
  type TestSeriesDetail,
  type TestSeriesSummary,
  type UpdateSeriesBranchesInput,
  type UpdateEventInput,
  type UpdateProgramInput,
  type UpdateTestSeriesInput,
} from './access';
import {
  ANNOUNCEMENT_ROUTES,
  announcementPreviewSchema,
  announcementSchema,
  announcementSummarySchema,
  type Announcement,
  type AnnouncementSummary,
  type AnnouncementListQueryInput,
  type AnnouncementPreview,
  type CreateAnnouncementInput,
} from './announcements';
import {
  ADMIN_BASE_CONFIG_ROUTES,
  baseConfigDetailSchema,
  baseConfigSchema,
  type BaseConfig,
  type BaseConfigDetail,
  type BaseConfigListQueryInput,
  type CloneBaseConfigInput,
  type CreateBaseConfigInput,
  type UpdateBaseConfigInput,
} from './configs';
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
} from './attempts';
import {
  OVERVIEW_ROUTES,
  PERFORMANCE_ROUTES,
  performanceReportSchema,
  questionReportSchema,
  reportSittingSchema,
  satSeriesSchema,
  studentOverviewSchema,
  testAnalyticsSchema,
  testCalendarSchema,
  type PerformanceReport,
  type QuestionReport,
  type PerformanceReportQueryInput,
  type ReportSitting,
  type SatSeries,
  type StudentOverview,
  type TestAnalytics,
  type TestCalendar,
} from './stats';
import {
  LEADERBOARD_ROUTES,
  leaderboardSchema,
  type Leaderboard,
  type LeaderboardQueryInput,
} from './leaderboard';
import {
  ADMIN_LIVE_OPS_ROUTES,
  liveOpsBoardSchema,
  liveOpsTestSchema,
  resolvedAttemptSchema,
  type ExtendAttemptInput,
  type ForceSubmitAttemptInput,
  type LiveOpsBoard,
  type LiveOpsTest,
  type LiveOpsTestQueryInput,
  type ResetAttemptInput,
  type ResolvedAttempt,
  type VoidAttemptInput,
} from './live-ops';
import {
  ADMIN_TEST_PAPER_ROUTES,
  ADMIN_TEST_ROUTES,
  testDetailSchema,
  testPaperSchema,
  testSchema,
  offerResultSchema,
  seriesTestRowSchema,
  testProgramUnlockSchema,
  testSeriesLinkSchema,
  testStatusSchema,
  type AddPaperQuestionInput,
  type CreateTestInput,
  type SetPaperQuestionStatusInput,
  type SetProgramUnlockInput,
  type SetTestSeriesInput,
  type SetTestStatusInput,
  type Test,
  type TestDetail,
  type TestListQueryInput,
  type TestPaper,
  type OfferResult,
  type SeriesTestRow,
  type SetSeriesTestUnlockInput,
  type TestProgramUnlock,
  type TestSeriesLink,
  type TestStatus,
  type UpdateTestInput,
} from './tests';
import {
  ADMIN_EXAM_ROUTES,
  ADMIN_EXAM_STAGE_ROUTES,
  examSchema,
  examStageSchema,
  type CreateExamInput,
  type CreateExamStageInput,
  type Exam,
  type ExamListQueryInput,
  type ExamStage,
  type ExamStageListQueryInput,
  type UpdateExamInput,
  type UpdateExamStageInput,
} from './exams';
import {
  ADMIN_STUDENT_ROUTES,
  studentDetailSchema,
  studentSummarySchema,
  type CreateStudentInput,
  type SetStudentTestBlockedBody,
  type StudentDetail,
  type StudentSittingsQueryInput,
  type StudentListQueryInput,
  type StudentSummary,
  type UpdateStudentInput,
} from './students';
import {
  IMPORT_FILE_FIELD,
  IMPORT_ROUTES,
  candidateImportPlanSchema,
  candidateImportResultSchema,
  programImportPlanSchema,
  programImportResultSchema,
  studentImportPlanSchema,
  studentImportResultSchema,
  type CandidateImportPlan,
  type CandidateImportResult,
  type ProgramImportPlan,
  type ProgramImportResult,
  type StudentImportPlan,
  type StudentImportResult,
} from './imports';

import {
  ADMIN_QUESTION_ROUTES,
  QUESTION_IMAGE_FILE_FIELD,
  questionImageSchema,
  ADMIN_TAXONOMY_ROUTES,
  QUESTION_IMPORT_ROUTES,
  questionDetailSchema,
  questionImportPlanSchema,
  questionImportResultSchema,
  questionAvailabilitySchema,
  questionSummarySchema,
  questionVersionSummarySchema,
  subjectSchema,
  topicSchema,
  type CreateSubjectInput,
  type CreateTopicInput,
  type QuestionDetail,
  type QuestionImage,
  type QuestionDraftInput,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionAvailability,
  type QuestionAvailabilityQueryInput,
  type QuestionListQueryInput,
  type QuestionSummary,
  type QuestionVersionSummary,
  type SetQuestionStatusInput,
  type Subject,
  type SubjectListQueryInput,
  type Topic,
  type TopicListQueryInput,
} from './questions';
import {
  ADMIN_ASSIGNMENTS_ROUTES,
  ADMIN_PROOFREADING_ROUTES,
  assignableAdminSchema,
  assignmentSchema,
  assignmentSectionSchema,
  assignmentTestSchema,
  assignmentWithTestSchema,
  questionOnOtherTestSchema,
  sectionCommentSchema,
  sectionEditLockSchema,
  sectionProgressRowSchema,
  type Assignment,
  type AssignableAdmin,
  type AssignableQueryInput,
  type AssignmentSection,
  type AssignmentSectionsQueryInput,
  type AssignmentTest,
  type AssignmentTestsQueryInput,
  type AssignmentWithTest,
  type CreateAssignmentInput,
  type CreateSectionCommentInput,
  type EditSectionCommentInput,
  type MineAssignmentsQueryInput,
  type QuestionOnOtherTest,
  type SectionComment,
  type SectionEditLock,
  type SectionProgressQueryInput,
  type SectionProgressRow,
} from './assignments';

/** Drops empty and undefined keys, so an unset filter never becomes `?q=undefined`. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    // An empty set is "don't care": sent, the server would read it as `in: []` and match nothing.
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(CSV_SEPARATOR));
      continue;
    }
    // Primitives only, each named. An object would become "[object Object]" in
    // the URL — a filter the server cannot read and nobody can see is wrong.
    if (typeof value === 'string') search.set(key, value);
    else if (typeof value === 'number' || typeof value === 'boolean') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

interface ApiClientOptions {
  baseUrl: string;
  /** Current access token, or null when signed out. */
  getAccessToken: () => string | null;
  /** Current refresh token, or null when signed out. */
  getRefreshToken: () => string | null;
  /** Called after a successful silent refresh so the caller can persist rotation. */
  onTokensRefreshed?: (tokens: AuthTokens) => void;
  /** Called when the session is unrecoverable — the caller should sign out. */
  onUnauthorized?: (cause?: AppException) => void;
  /** Sent on every request, e.g. which app this is. */
  headers?: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
}

type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions<T> {
  method?: 'GET' | WriteMethod;
  body?: unknown;
  schema: ZodType<T>;
  /** Skip the Authorization header and the refresh-on-401 dance. */
  anonymous?: boolean;
}

/** Callers never see the envelope: every method returns `data` or throws an `AppException`. */
export function createApiClient(options: ApiClientOptions) {
  const {
    baseUrl,
    getAccessToken,
    getRefreshToken,
    onTokensRefreshed,
    onUnauthorized,
    headers = {},
    fetchImpl = globalThis.fetch,
  } = options;

  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

  /** Single-flight guard: many parallel 401s trigger exactly one refresh call. */
  let refreshInFlight: Promise<AuthTokens | null> | null = null;
  /** The AppException from the last failed refresh, so `onUnauthorized` can say why. */
  let refreshFailure: AppException | undefined;

  async function send(path: string, method: string, body: unknown, token: string | null) {
    // FormData: the browser must set its own Content-Type, boundary included.
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    try {
      return await fetchImpl(url(path), {
        method,
        headers: {
          ...headers,
          ...(body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) }),
      });
    } catch (cause) {
      // The request never landed — offline, DNS, CORS, a dead API. Same typed
      // error as everything else, so callers need no second code path.
      throw new AppException(
        ErrorCodes.INTERNAL,
        'Cannot reach the server. Check your connection.',
        {
          httpStatus: 0,
          cause,
        },
      );
    }
  }

  /** Both halves are validated: an unrecognised shape must never reach a caller typed as data. */
  async function parse<T>(response: Response, schema: ZodType<T>): Promise<ApiSuccess<T>> {
    if (response.status === NO_CONTENT) return noContentOf(response, schema);
    const text = await response.text();

    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new AppException(
        errorCodeForStatus(response.status),
        'The server sent a malformed response',
        {
          httpStatus: response.status,
        },
      );
    }

    const failure = apiFailureSchema.safeParse(payload);
    if (failure.success) throw AppException.fromFailure(failure.data, response.status);

    if (!response.ok) {
      // A non-2xx that is not our envelope came from something in front of the
      // API — a proxy, a gateway, a framework default we do not control.
      throw new AppException(
        errorCodeForStatus(response.status),
        `Request failed (${response.status})`,
        {
          httpStatus: response.status,
        },
      );
    }

    const success = apiSuccessSchema(schema).safeParse(payload);
    if (!success.success) {
      throw new AppException(ErrorCodes.INTERNAL, 'Unexpected response shape from API', {
        httpStatus: response.status,
        details: success.error.issues,
      });
    }
    return success.data as ApiSuccess<T>;
  }

  async function refreshTokens(): Promise<AuthTokens | null> {
    refreshFailure = undefined;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    for (let asked = 0; ; asked += 1) {
      try {
        const envelope = await parse(
          await send(AUTH_ROUTES.refresh, 'POST', { refreshToken }, null),
          authTokensSchema,
        );
        onTokensRefreshed?.(envelope.data);
        return envelope.data;
      } catch (error) {
        // Refresh being REFUSED is a normal end-of-session; anything else is asked again below.
        refreshFailure = AppException.is(error) ? error : undefined;
        const backoff = worthAskingAgain(refreshFailure) ? refreshBackoffMs(asked) : undefined;
        if (backoff === undefined) return null;
        await new Promise((wake) => setTimeout(wake, backoff));
      }
    }
  }

  /** A refusal ends it, and so does having nothing to refresh with. A failure we could not reach does not. */
  const sessionIsOver = (): boolean =>
    getRefreshToken() === null || !worthAskingAgain(refreshFailure);

  async function envelopeOf<T>(path: string, opts: RequestOptions<T>): Promise<ApiSuccess<T>> {
    const { method = 'GET', body, schema, anonymous = false } = opts;

    if (anonymous) return parse(await send(path, method, body, null), schema);

    const response = await send(path, method, body, getAccessToken());
    if (response.status !== 401) return parse(response, schema);

    const peeked = await peekFailure(response);

    // A replaced session is over for good; refreshing would only be refused the same way.
    if (peeked?.error.code === ErrorCodes.SESSION_REPLACED) {
      const replaced = AppException.fromFailure(peeked, response.status);
      onUnauthorized?.(replaced);
      throw replaced;
    }

    // Only an expired session is worth retrying: refreshing on a wrong PIN hides the real code.
    if (peeked && peeked.error.code !== 'UNAUTHENTICATED') {
      throw AppException.fromFailure(peeked, response.status);
    }

    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      if (sessionIsOver()) onUnauthorized?.(refreshFailure);
      throw endedBy(refreshFailure, peeked);
    }

    const retried = await send(path, method, body, refreshed.accessToken);
    if (retried.status === 401) onUnauthorized?.(await failureOf(retried));
    return parse(retried, schema);
  }

  /** The everyday call: returns `data`, throws `AppException`. */
  async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
    return (await envelopeOf(path, opts)).data;
  }

  /** Recombines `data` with the pagination from `meta`, so callers get one page object. */
  async function requestPaginated<T>(
    path: string,
    opts: RequestOptions<T[]>,
  ): Promise<Paginated<T>> {
    const { data, meta } = await envelopeOf(path, opts);
    return {
      items: data,
      page: meta.page ?? 1,
      pageSize: meta.pageSize ?? data.length,
      total: meta.total ?? data.length,
    };
  }

  /**
   * A binary download, authenticated and refresh-aware. It cannot go through `parse` —
   * reading the body as text would corrupt the file — but a FAILURE is still an envelope.
   */
  async function requestBlob(path: string): Promise<Blob> {
    let response = await send(path, 'GET', undefined, getAccessToken());

    if (response.status === 401) {
      const refreshed = await refreshTokens();
      if (!refreshed) {
        if (sessionIsOver()) onUnauthorized?.();
        throw endedBy(refreshFailure, await peekFailure(response));
      }
      response = await send(path, 'GET', undefined, refreshed.accessToken);
    }

    if (!response.ok) {
      const failure = await peekFailure(response);
      throw new AppException(
        failure?.error.code ?? errorCodeForStatus(response.status),
        failure?.error.message ?? 'That file could not be downloaded',
        { httpStatus: response.status },
      );
    }

    return response.blob();
  }

  const get = <T>(path: string, schema: ZodType<T>) => request(path, { schema });
  const write = <T>(method: WriteMethod, path: string, schema: ZodType<T>, body?: unknown) =>
    request(path, { method, body, schema });
  const list = <T>(path: string, query: object, schema: ZodType<T>) =>
    requestPaginated(`${path}${queryString({ ...query })}`, { schema: schema.array() });

  return {
    request,
    requestPaginated,
    requestBlob,

    auth: {
      /** Student signup or PIN reset, step 1. */
      requestStudentOtp: (input: RequestStudentOtpInput): Promise<OtpRequestResponse> =>
        request(AUTH_ROUTES.studentOtpRequest, {
          method: 'POST',
          body: input,
          schema: otpRequestResponseSchema,
          anonymous: true,
        }),

      /** Step 2 — proves the number and returns a ticket, not a session. */
      verifyStudentOtp: (input: VerifyStudentOtpInput): Promise<PinSetupTicket> =>
        request(AUTH_ROUTES.studentOtpVerify, {
          method: 'POST',
          body: input,
          schema: pinSetupTicketSchema,
          anonymous: true,
        }),

      /** Step 3 — redeems the ticket, stores the PIN and signs the student in. */
      setStudentPin: (input: SetStudentPinInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.studentPinSet, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      /** The everyday student login: mobile + 4-digit PIN, no OTP. */
      loginStudent: (input: StudentLoginInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.studentLogin, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      requestAdminOtp: (input: RequestAdminOtpInput): Promise<OtpRequestResponse> =>
        request(AUTH_ROUTES.adminOtpRequest, {
          method: 'POST',
          body: input,
          schema: otpRequestResponseSchema,
          anonymous: true,
        }),

      verifyAdminOtp: (input: VerifyAdminOtpInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.adminOtpVerify, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      me: (): Promise<AuthIdentity> => get(AUTH_ROUTES.me, authIdentitySchema),

      /** The envelope's `success` is the whole answer; there is no payload. */
      logout: (): Promise<NoContent> => write('POST', AUTH_ROUTES.logout, noContentSchema),
    },

    /** Admin-only. A student token gets 403 from every one of these. */
    /** The signed-in student's own account. No ids — the token is the subject. */
    me: {
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
      sessions: (): Promise<DeviceSession[]> =>
        get(ME_ROUTES.sessions, deviceSessionSchema.array()),

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
      saveAttemptState: (
        attemptId: string,
        input: SaveAttemptStateInput,
      ): Promise<AttemptSaveAck> =>
        write('PATCH', ME_ATTEMPT_ROUTES.state(attemptId), attemptSaveAckSchema, input),

      /** What the server is holding, so a reloaded tab can seed its answers instead of starting blank. */
      attemptState: (attemptId: string): Promise<LiveAttemptState> =>
        get(ME_ATTEMPT_ROUTES.state(attemptId), liveAttemptStateSchema),

      /** Ends it. A second call reports the first one's outcome rather than refusing. */
      submitAttempt: (
        attemptId: string,
        input: SubmitAttemptInput = {},
      ): Promise<SubmittedAttempt> =>
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
    },

    admin: {
      /** Watching one test's sittings, and resolving the ones that broke. */
      liveOps: {
        tests: (query: LiveOpsTestQueryInput = {}): Promise<Paginated<LiveOpsTest>> =>
          list(ADMIN_LIVE_OPS_ROUTES.tests, query, liveOpsTestSchema),

        board: (testId: string): Promise<LiveOpsBoard> =>
          get(ADMIN_LIVE_OPS_ROUTES.board(testId), liveOpsBoardSchema),

        forceSubmit: (
          attemptId: string,
          input: ForceSubmitAttemptInput,
        ): Promise<ResolvedAttempt> =>
          write('POST', ADMIN_LIVE_OPS_ROUTES.forceSubmit(attemptId), resolvedAttemptSchema, input),

        extend: (attemptId: string, input: ExtendAttemptInput): Promise<ResolvedAttempt> =>
          write('POST', ADMIN_LIVE_OPS_ROUTES.extend(attemptId), resolvedAttemptSchema, input),

        reset: (attemptId: string, input: ResetAttemptInput): Promise<ResolvedAttempt> =>
          write('POST', ADMIN_LIVE_OPS_ROUTES.reset(attemptId), resolvedAttemptSchema, input),

        void: (attemptId: string, input: VoidAttemptInput): Promise<ResolvedAttempt> =>
          write('POST', ADMIN_LIVE_OPS_ROUTES.void(attemptId), resolvedAttemptSchema, input),
      },

      /** What an admin says to a cohort, and what reaching them cost. */
      announcements: {
        list: (query: AnnouncementListQueryInput = {}): Promise<Paginated<AnnouncementSummary>> =>
          list(ANNOUNCEMENT_ROUTES.list, query, announcementSummarySchema),

        /** Asked while composing. Changes nothing — the cohort is read off the body. */
        preview: (input: CreateAnnouncementInput): Promise<AnnouncementPreview> =>
          write('POST', ANNOUNCEMENT_ROUTES.preview, announcementPreviewSchema, input),

        send: (input: CreateAnnouncementInput): Promise<Announcement> =>
          write('POST', ANNOUNCEMENT_ROUTES.create, announcementSchema, input),

        detail: (id: string): Promise<Announcement> =>
          get(ANNOUNCEMENT_ROUTES.detail(id), announcementSchema),
      },

      students: {
        list: (query: StudentListQueryInput = {}): Promise<Paginated<StudentSummary>> =>
          list(ADMIN_STUDENT_ROUTES.list, query, studentSummarySchema),

        detail: (id: string): Promise<StudentDetail> =>
          get(ADMIN_STUDENT_ROUTES.detail(id), studentDetailSchema),

        create: (input: CreateStudentInput): Promise<StudentDetail> =>
          write('POST', ADMIN_STUDENT_ROUTES.create, studentDetailSchema, input),

        update: (id: string, input: UpdateStudentInput): Promise<StudentDetail> =>
          write('PATCH', ADMIN_STUDENT_ROUTES.update(id), studentDetailSchema, input),

        setActive: (id: string, isActive: boolean): Promise<StudentDetail> =>
          write('PATCH', ADMIN_STUDENT_ROUTES.setActive(id), studentDetailSchema, { isActive }),

        setTestBlocked: (id: string, input: SetStudentTestBlockedBody): Promise<StudentDetail> =>
          write('PATCH', ADMIN_STUDENT_ROUTES.setTestBlocked(id), studentDetailSchema, input),

        /** Their evaluated sittings, paged. The share picker's own list is capped; a report's is not. */
        sittings: (
          id: string,
          query: StudentSittingsQueryInput,
        ): Promise<Paginated<ReportSitting>> =>
          list(ADMIN_STUDENT_ROUTES.sittings(id), query, reportSittingSchema),

        /** Anonymises the person. Super admin only, and every sitting they sat is left standing. */
        erase: (id: string): Promise<ErasureReceipt> =>
          write('POST', ADMIN_STUDENT_ROUTES.erasure(id), erasureReceiptSchema),

        /** Any student's analytics, behind STUDENT_PERFORMANCE. Same payload the student reads. */
        performance: (id: string, query: PerformanceReportQueryInput): Promise<PerformanceReport> =>
          get(
            `${PERFORMANCE_ROUTES.ofStudent(id)}${queryString({ ...query })}`,
            performanceReportSchema,
          ),
      },

      /** Super admin only, enforced server-side. The client does not re-state it. */
      admins: {
        list: (query: AdminListQueryInput = {}): Promise<Paginated<Admin>> =>
          list(ADMIN_ADMIN_ROUTES.list, query, adminSchema),

        create: (input: CreateAdminInput): Promise<Admin> =>
          write('POST', ADMIN_ADMIN_ROUTES.create, adminSchema, input),

        /** Display fields only — the role labels the person, it does not grant them anything. */
        update: (id: string, input: UpdateAdminBody): Promise<Admin> =>
          write('PATCH', ADMIN_ADMIN_ROUTES.update(id), adminSchema, input),

        /** Deactivating prunes every grant. Reactivating does NOT restore them. */
        setActive: (id: string, isActive: boolean): Promise<Admin> =>
          write('PATCH', ADMIN_ADMIN_ROUTES.setActive(id), adminSchema, { isActive }),
      },

      features: {
        list: (): Promise<Feature[]> => get(ADMIN_FEATURE_ROUTES.list, featureSchema.array()),

        grant: (input: PermissionGrantInput): Promise<Feature> =>
          write('POST', ADMIN_FEATURE_ROUTES.grant, featureSchema, input),

        revoke: (input: PermissionGrantBody): Promise<Feature> =>
          write(
            'DELETE',
            ADMIN_FEATURE_ROUTES.revoke(input.featureKey, input.level, input.adminId),
            featureSchema,
          ),
      },

      branches: {
        list: (query: BranchListQueryInput = {}): Promise<Paginated<Branch>> =>
          list(ADMIN_BRANCH_ROUTES.list, query, branchSchema),

        create: (input: CreateBranchInput): Promise<Branch> =>
          write('POST', ADMIN_BRANCH_ROUTES.create, branchSchema, input),

        update: (id: string, input: UpdateBranchInput): Promise<Branch> =>
          write('PATCH', ADMIN_BRANCH_ROUTES.update(id), branchSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_BRANCH_ROUTES.remove(id), noContentSchema),
      },

      exams: {
        list: (query: ExamListQueryInput = {}): Promise<Paginated<Exam>> =>
          list(ADMIN_EXAM_ROUTES.list, query, examSchema),

        create: (input: CreateExamInput): Promise<Exam> =>
          write('POST', ADMIN_EXAM_ROUTES.create, examSchema, input),

        update: (id: string, input: UpdateExamInput): Promise<Exam> =>
          write('PATCH', ADMIN_EXAM_ROUTES.update(id), examSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_EXAM_ROUTES.remove(id), noContentSchema),
      },

      /** The stage layer: what a base config, a series and a test all hang off. */
      examStages: {
        list: (query: ExamStageListQueryInput = {}): Promise<Paginated<ExamStage>> =>
          list(ADMIN_EXAM_STAGE_ROUTES.list, query, examStageSchema),

        create: (input: CreateExamStageInput): Promise<ExamStage> =>
          write('POST', ADMIN_EXAM_STAGE_ROUTES.create, examStageSchema, input),

        update: (id: string, input: UpdateExamStageInput): Promise<ExamStage> =>
          write('PATCH', ADMIN_EXAM_STAGE_ROUTES.update(id), examStageSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_EXAM_STAGE_ROUTES.remove(id), noContentSchema),
      },

      /** The coaching variants a student can be a candidate for. */
      programs: {
        list: (query: ProgramListQueryInput = {}): Promise<Paginated<Program>> =>
          list(ADMIN_PROGRAM_ROUTES.list, query, programCatalogSchema),

        create: (input: CreateProgramInput): Promise<Program> =>
          write('POST', ADMIN_PROGRAM_ROUTES.create, programCatalogSchema, input),

        update: (id: string, input: UpdateProgramInput): Promise<Program> =>
          write('PATCH', ADMIN_PROGRAM_ROUTES.update(id), programCatalogSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_PROGRAM_ROUTES.remove(id), noContentSchema),
      },

      /** Who an EVENT series reaches — sitters, not necessarily students yet. */
      events: {
        list: (query: EventListQueryInput = {}): Promise<Paginated<Event>> =>
          list(EVENT_ROUTES.list, query, eventSchema),

        detail: (id: string): Promise<Event> => get(EVENT_ROUTES.detail(id), eventSchema),

        create: (input: CreateEventInput): Promise<Event> =>
          write('POST', EVENT_ROUTES.create, eventSchema, input),

        update: (id: string, input: UpdateEventInput): Promise<Event> =>
          write('PATCH', EVENT_ROUTES.update(id), eventSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', EVENT_ROUTES.remove(id), noContentSchema),

        addCandidates: (id: string, input: AddEventCandidatesInput): Promise<EventCandidate[]> =>
          write('POST', EVENT_ROUTES.addCandidates(id), eventCandidateSchema.array(), input),

        removeCandidate: (id: string, studentId: string): Promise<NoContent> =>
          write('DELETE', EVENT_ROUTES.removeCandidate(id, studentId), noContentSchema),
      },

      /** The unit of offering. A test reaches a student only through one of these. */
      testSeries: {
        list: (query: TestSeriesListQueryInput = {}): Promise<Paginated<TestSeriesSummary>> =>
          list(ADMIN_SERIES_ROUTES.list, query, testSeriesSummarySchema),

        detail: (id: string): Promise<TestSeriesDetail> =>
          get(ADMIN_SERIES_ROUTES.detail(id), testSeriesDetailSchema),

        create: (input: CreateTestSeriesInput): Promise<TestSeriesDetail> =>
          write('POST', ADMIN_SERIES_ROUTES.create, testSeriesDetailSchema, input),

        update: (id: string, input: UpdateTestSeriesInput): Promise<TestSeriesDetail> =>
          write('PATCH', ADMIN_SERIES_ROUTES.update(id), testSeriesDetailSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_SERIES_ROUTES.remove(id), noContentSchema),

        /** Every branch, and whether this series reaches it, scoped to what the caller may see. */
        branches: (id: string): Promise<SeriesBranch[]> =>
          get(ADMIN_SERIES_ROUTES.branches(id), seriesBranchSchema.array()),

        setBranches: (id: string, input: UpdateSeriesBranchesInput): Promise<SeriesBranch[]> =>
          write('PUT', ADMIN_SERIES_ROUTES.branches(id), seriesBranchSchema.array(), input),

        tests: (id: string): Promise<SeriesTestRow[]> =>
          get(ADMIN_SERIES_ROUTES.tests(id), seriesTestRowSchema.array()),

        setTestUnlock: (
          id: string,
          testId: string,
          input: SetSeriesTestUnlockInput,
        ): Promise<SeriesTestRow[]> =>
          write('PATCH', ADMIN_SERIES_ROUTES.test(id, testId), seriesTestRowSchema.array(), input),
      },

      /** Every series a student reaches and what opens each one, the branch gate already applied. */
      studentSeries: {
        list: (studentId: string): Promise<StudentSeriesAccess[]> =>
          get(ADMIN_STUDENT_SERIES_ROUTES.list(studentId), studentSeriesAccessSchema.array()),
      },

      /** The escape hatch, filed against the student it was made about. */
      grants: {
        create: (studentId: string, input: GrantSeriesInput): Promise<StudentGrantRow[]> =>
          write('POST', ADMIN_GRANT_ROUTES.create(studentId), studentGrantRowSchema.array(), input),

        remove: (studentId: string, testSeriesId: string): Promise<NoContent> =>
          write('DELETE', ADMIN_GRANT_ROUTES.remove(studentId, testSeriesId), noContentSchema),
      },

      /** A stage's blueprints. The shape freezes at the first finalize — clone to evolve. */
      baseConfigs: {
        list: (query: BaseConfigListQueryInput = {}): Promise<Paginated<BaseConfig>> =>
          list(ADMIN_BASE_CONFIG_ROUTES.list, query, baseConfigSchema),

        detail: (id: string): Promise<BaseConfigDetail> =>
          get(ADMIN_BASE_CONFIG_ROUTES.detail(id), baseConfigDetailSchema),

        create: (input: CreateBaseConfigInput): Promise<BaseConfigDetail> =>
          write('POST', ADMIN_BASE_CONFIG_ROUTES.create, baseConfigDetailSchema, input),

        update: (id: string, input: UpdateBaseConfigInput): Promise<BaseConfigDetail> =>
          write('PATCH', ADMIN_BASE_CONFIG_ROUTES.update(id), baseConfigDetailSchema, input),

        clone: (id: string, input: CloneBaseConfigInput = {}): Promise<BaseConfigDetail> =>
          write('POST', ADMIN_BASE_CONFIG_ROUTES.clone(id), baseConfigDetailSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_BASE_CONFIG_ROUTES.remove(id), noContentSchema),
      },

      /** The tests built from a config. Every shape field is read through it, never copied. */
      tests: {
        list: (query: TestListQueryInput = {}): Promise<Paginated<Test>> =>
          list(ADMIN_TEST_ROUTES.list, query, testSchema),

        detail: (id: string): Promise<TestDetail> =>
          get(ADMIN_TEST_ROUTES.detail(id), testDetailSchema),

        create: (input: CreateTestInput): Promise<TestDetail> =>
          write('POST', ADMIN_TEST_ROUTES.create, testDetailSchema, input),

        update: (id: string, input: UpdateTestInput): Promise<TestDetail> =>
          write('PATCH', ADMIN_TEST_ROUTES.update(id), testDetailSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_TEST_ROUTES.remove(id), noContentSchema),

        /** How the cohort did on it: the three rollups, read whole and derived from. */
        analytics: (id: string): Promise<TestAnalytics> =>
          get(ADMIN_TEST_ROUTES.analytics(id), testAnalyticsSchema),

        /** Queues an immediate rebuild; the analytics read shows it landing through `computedAt`. */
        resyncAnalytics: (id: string): Promise<NoContent> =>
          write('POST', ADMIN_TEST_ROUTES.resyncAnalytics(id), noContentSchema),

        /** The paper as it stands, built a question or a section at a time. */
        readPaper: (id: string): Promise<TestPaper> =>
          get(ADMIN_TEST_PAPER_ROUTES.read(id), testPaperSchema),

        /** Several at once, in the next free places its section has. */
        addPaperQuestions: (id: string, input: AddPaperQuestionInput): Promise<TestPaper> =>
          write('POST', ADMIN_TEST_PAPER_ROUTES.addQuestion(id), testPaperSchema, input),

        removePaperQuestions: (id: string, rowIds: readonly string[]): Promise<TestPaper> =>
          write(
            'DELETE',
            `${ADMIN_TEST_PAPER_ROUTES.removeQuestions(id)}${queryString({ rowIds: [...rowIds] })}`,
            testPaperSchema,
          ),

        /** Fills the rest of one section from its own spec; every hand-picked row keeps its place. */
        fillPaperSection: (id: string, sectionId: string): Promise<TestPaper> =>
          write('POST', ADMIN_TEST_PAPER_ROUTES.fillSection(id, sectionId), testPaperSchema),

        /** Drops a question or makes it a bonus, and re-scores every sitting that served it. */
        setPaperQuestionStatus: (
          id: string,
          rowId: string,
          input: SetPaperQuestionStatusInput,
        ): Promise<TestPaper> =>
          write('PATCH', ADMIN_TEST_PAPER_ROUTES.questionStatus(id, rowId), testPaperSchema, input),

        offer: (id: string): Promise<OfferResult> =>
          write('POST', ADMIN_TEST_PAPER_ROUTES.offer(id), offerResultSchema),

        moveToSeries: (id: string, input: SetTestSeriesInput): Promise<TestSeriesLink> =>
          write('POST', ADMIN_TEST_PAPER_ROUTES.series(id), testSeriesLinkSchema, input),

        setStatus: (id: string, input: SetTestStatusInput): Promise<TestStatus> =>
          write('PATCH', ADMIN_TEST_PAPER_ROUTES.setStatus(id), testStatusSchema, input),

        /** A program opens a test EARLIER; entry still closes when it closes for everyone. */
        setProgramUnlock: (
          id: string,
          programCode: string,
          input: SetProgramUnlockInput,
        ): Promise<TestProgramUnlock[]> =>
          write(
            'PUT',
            ADMIN_TEST_PAPER_ROUTES.programUnlock(id, programCode),
            testProgramUnlockSchema.array(),
            input,
          ),

        clearProgramUnlock: (id: string, programCode: string): Promise<TestProgramUnlock[]> =>
          write(
            'DELETE',
            ADMIN_TEST_PAPER_ROUTES.programUnlock(id, programCode),
            testProgramUnlockSchema.array(),
          ),
      },

      /** Subject -> Topic. Anything finer than a topic is a `topic:` tag on the question. */
      taxonomy: {
        listSubjects: (query: SubjectListQueryInput = {}): Promise<Paginated<Subject>> =>
          list(ADMIN_TAXONOMY_ROUTES.subjects, query, subjectSchema),

        createSubject: (input: CreateSubjectInput): Promise<Subject> =>
          write('POST', ADMIN_TAXONOMY_ROUTES.subjects, subjectSchema, input),

        listTopics: (query: TopicListQueryInput = {}): Promise<Paginated<Topic>> =>
          list(ADMIN_TAXONOMY_ROUTES.topics, query, topicSchema),

        createTopic: (input: CreateTopicInput): Promise<Topic> =>
          write('POST', ADMIN_TAXONOMY_ROUTES.topics, topicSchema, input),
      },

      /** A typist's own questions. Every route here is scoped to the caller by the server. */
      authoring: {
        stats: (): Promise<AuthoringStats> =>
          get(ADMIN_AUTHORING_ROUTES.stats, authoringStatsSchema),

        history: (query: AuthoringHistoryQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
          list(ADMIN_AUTHORING_ROUTES.history, query, questionSummarySchema),

        detail: (id: string): Promise<QuestionDetail> =>
          get(ADMIN_AUTHORING_ROUTES.get(id), questionDetailSchema),

        create: (input: AuthoringCreateInput): Promise<AuthoringSaveResult> =>
          write('POST', ADMIN_AUTHORING_ROUTES.create, authoringSaveResultSchema, input),
        // A POST for a read: the key is folded from the whole draft, which no query string carries.
        duplicate: (input: QuestionDraftInput, exceptId?: string): Promise<AuthoringDuplicate> =>
          write('POST', ADMIN_AUTHORING_ROUTES.duplicate, authoringDuplicateSchema, {
            ...input,
            exceptId: exceptId || null,
          }),

        update: (id: string, input: QuestionDraftInput): Promise<AuthoringSaveResult> =>
          write('PATCH', ADMIN_AUTHORING_ROUTES.update(id), authoringSaveResultSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_AUTHORING_ROUTES.remove(id), noContentSchema),

        /** Hands the section's work so far to its proof-reader. */
        release: (assignmentId: string): Promise<AuthoringRelease> =>
          write('POST', ADMIN_AUTHORING_ROUTES.release(assignmentId), authoringReleaseSchema),

        previewImport: (assignmentId: string, file: File): Promise<QuestionImportPlan> =>
          write(
            'POST',
            ADMIN_AUTHORING_ROUTES.importPreview(assignmentId),
            questionImportPlanSchema,
            fileBody(file),
          ),

        commitImport: (assignmentId: string, importLogId: string): Promise<QuestionImportResult> =>
          write(
            'POST',
            ADMIN_AUTHORING_ROUTES.importCommit(assignmentId),
            questionImportResultSchema,
            { importLogId },
          ),
      },

      questions: {
        list: (query: QuestionListQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
          list(ADMIN_QUESTION_ROUTES.list, query, questionSummarySchema),

        detail: (id: string): Promise<QuestionDetail> =>
          get(ADMIN_QUESTION_ROUTES.get(id), questionDetailSchema),

        /** Newest first, and never long: a chain gains a link only once a paper pins the old one. */
        versions: (id: string): Promise<QuestionVersionSummary[]> =>
          get(ADMIN_QUESTION_ROUTES.versions(id), questionVersionSummarySchema.array()),

        /** Counts, not a page: what a section can actually be drawn from. */
        availability: (query: QuestionAvailabilityQueryInput = {}): Promise<QuestionAvailability> =>
          get(
            `${ADMIN_QUESTION_ROUTES.availability}${queryString({ ...query })}`,
            questionAvailabilitySchema,
          ),

        create: (input: QuestionDraftInput): Promise<QuestionDetail> =>
          write('POST', ADMIN_QUESTION_ROUTES.create, questionDetailSchema, input),

        update: (id: string, input: QuestionDraftInput): Promise<QuestionDetail> =>
          write('PATCH', ADMIN_QUESTION_ROUTES.update(id), questionDetailSchema, input),

        /** ARCHIVED retires a question: it is drawn into no future paper. */
        setStatus: (id: string, input: SetQuestionStatusInput): Promise<QuestionDetail> =>
          write('PATCH', ADMIN_QUESTION_ROUTES.setStatus(id), questionDetailSchema, input),

        /** The soft remove: out of circulation and out of the bank, losing nothing. */
        archive: (id: string): Promise<QuestionDetail> =>
          write('POST', ADMIN_QUESTION_ROUTES.archive(id), questionDetailSchema),

        unarchive: (id: string): Promise<QuestionDetail> =>
          write('POST', ADMIN_QUESTION_ROUTES.unarchive(id), questionDetailSchema),

        /** Only a draft nothing has drawn. Everything else is archived, never removed. */
        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_QUESTION_ROUTES.remove(id), noContentSchema),

        /** One decision over a page of drafts — one request, so nothing is half-approved. */

        /** Content stores the `key`; the `url` is for showing the image that was just chosen. */
        uploadImage: (file: File): Promise<QuestionImage> => {
          const form = new FormData();
          form.append(QUESTION_IMAGE_FILE_FIELD, file);
          return write('POST', ADMIN_QUESTION_ROUTES.uploadImage, questionImageSchema, form);
        },
      },

      /** The proof-reading document, and the flags raised on it. */
      proofreading: {
        /** A section reads in full: the typist's own questions and the bank picks beside them. */
        forAssignment: (assignmentId: string): Promise<QuestionDetail[]> =>
          get(ADMIN_PROOFREADING_ROUTES.forAssignment(assignmentId), questionDetailSchema.array()),

        /** One question of it, which is what the screen that edits it opens on. */
        oneQuestion: (assignmentId: string, questionId: string): Promise<QuestionDetail> =>
          get(
            ADMIN_PROOFREADING_ROUTES.oneQuestion(assignmentId, questionId),
            questionDetailSchema,
          ),

        editQuestion: (
          assignmentId: string,
          questionId: string,
          input: QuestionDraftInput,
        ): Promise<QuestionDetail> =>
          write(
            'PATCH',
            ADMIN_PROOFREADING_ROUTES.editQuestion(assignmentId, questionId),
            questionDetailSchema,
            input,
          ),

        /** The cross-test warning, read before the edit rather than reported after it. */
        otherTests: (assignmentId: string, questionId: string): Promise<QuestionOnOtherTest[]> =>
          get(
            ADMIN_PROOFREADING_ROUTES.otherTests(assignmentId, questionId),
            questionOnOtherTestSchema.array(),
          ),

        /** The same three reads, keyed on the section itself — a super admin needs no assignment. */
        forSection: (testId: string, sectionId: string): Promise<QuestionDetail[]> =>
          get(
            ADMIN_PROOFREADING_ROUTES.forSection(testId, sectionId),
            questionDetailSchema.array(),
          ),

        oneSectionQuestion: (
          testId: string,
          sectionId: string,
          questionId: string,
        ): Promise<QuestionDetail> =>
          get(
            ADMIN_PROOFREADING_ROUTES.oneSectionQuestion(testId, sectionId, questionId),
            questionDetailSchema,
          ),

        editSectionQuestion: (
          testId: string,
          sectionId: string,
          questionId: string,
          input: QuestionDraftInput,
        ): Promise<QuestionDetail> =>
          write(
            'PATCH',
            ADMIN_PROOFREADING_ROUTES.editSectionQuestion(testId, sectionId, questionId),
            questionDetailSchema,
            input,
          ),

        sectionOtherTests: (
          testId: string,
          sectionId: string,
          questionId: string,
        ): Promise<QuestionOnOtherTest[]> =>
          get(
            ADMIN_PROOFREADING_ROUTES.sectionOtherTests(testId, sectionId, questionId),
            questionOnOtherTestSchema.array(),
          ),
      },

      /** Who types a section and who reads it, and the queue each of them works from. */
      assignments: {
        forTest: (testId: string): Promise<Assignment[]> =>
          get(ADMIN_ASSIGNMENTS_ROUTES.forTest(testId), assignmentSchema.array()),

        assign: (testId: string, input: CreateAssignmentInput): Promise<Assignment> =>
          write('POST', ADMIN_ASSIGNMENTS_ROUTES.assign(testId), assignmentSchema, input),

        remove: (id: string): Promise<NoContent> =>
          write('DELETE', ADMIN_ASSIGNMENTS_ROUTES.remove(id), noContentSchema),

        mine: (query: MineAssignmentsQueryInput = {}): Promise<Paginated<AssignmentWithTest>> =>
          list(ADMIN_ASSIGNMENTS_ROUTES.mine, query, assignmentWithTestSchema),

        /** How every section is going, for a super admin. Read only — nothing here acts. */
        progress: (query: SectionProgressQueryInput = {}): Promise<Paginated<SectionProgressRow>> =>
          list(ADMIN_ASSIGNMENTS_ROUTES.progress, query, sectionProgressRowSchema),

        /** The row a queue link opens, read on its own so a long queue never hides it. */
        one: (id: string): Promise<AssignmentWithTest> =>
          get(ADMIN_ASSIGNMENTS_ROUTES.one(id), assignmentWithTestSchema),

        finalize: (id: string): Promise<Assignment> =>
          write('PATCH', ADMIN_ASSIGNMENTS_ROUTES.finalize(id), assignmentSchema),

        assignable: (query: AssignableQueryInput): Promise<AssignableAdmin[]> =>
          get(
            `${ADMIN_ASSIGNMENTS_ROUTES.assignable}${queryString({ ...query })}`,
            assignableAdminSchema.array(),
          ),

        /** What a test picker offers: their own, or every unfrozen test for a super admin. */
        tests: (query: AssignmentTestsQueryInput = {}): Promise<Paginated<AssignmentTest>> =>
          list(ADMIN_ASSIGNMENTS_ROUTES.tests, query, assignmentTestSchema),

        /** Unpaged, because a base config holds a dozen sections and never a page's worth. */
        sectionsOf: (
          testId: string,
          query: AssignmentSectionsQueryInput = {},
        ): Promise<AssignmentSection[]> =>
          get(
            `${ADMIN_ASSIGNMENTS_ROUTES.sectionsOf(testId)}${queryString({ ...query })}`,
            assignmentSectionSchema.array(),
          ),

        /** Who holds the section right now — read on load, so the warning lands before the work. */
        sectionLock: (testId: string, sectionId: string): Promise<SectionEditLock> =>
          get(ADMIN_ASSIGNMENTS_ROUTES.sectionLock(testId, sectionId), sectionEditLockSchema),

        /** The section thread, oldest first — a discussion is read in the order it was said. */
        comments: (testId: string, sectionId: string): Promise<SectionComment[]> =>
          get(ADMIN_ASSIGNMENTS_ROUTES.comments(testId, sectionId), sectionCommentSchema.array()),

        comment: (
          testId: string,
          sectionId: string,
          input: CreateSectionCommentInput,
        ): Promise<SectionComment> =>
          write(
            'POST',
            ADMIN_ASSIGNMENTS_ROUTES.comments(testId, sectionId),
            sectionCommentSchema,
            input,
          ),

        /** Rewording one, which only its own author does. */
        editComment: (
          testId: string,
          sectionId: string,
          commentId: string,
          input: EditSectionCommentInput,
        ): Promise<SectionComment> =>
          write(
            'PATCH',
            ADMIN_ASSIGNMENTS_ROUTES.editComment(testId, sectionId, commentId),
            sectionCommentSchema,
            input,
          ),
      },

      imports: {
        /** The sample workbook — a Blob, not an envelope. */
        studentTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.studentsTemplate),

        /** Writes nothing — this is what the admin reads before committing. */
        previewStudents: (file: File): Promise<StudentImportPlan> =>
          write('POST', IMPORT_ROUTES.studentsPreview, studentImportPlanSchema, fileBody(file)),

        commitStudents: (file: File): Promise<StudentImportResult> =>
          write('POST', IMPORT_ROUTES.studentsCommit, studentImportResultSchema, fileBody(file)),

        /** The candidate sample — a Blob, not an envelope. */
        candidateTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.candidatesTemplate),

        /** An event intake: an existing number joins the roster and nothing about them is edited. */
        previewEventCandidates: (eventId: string, file: File): Promise<CandidateImportPlan> =>
          write(
            'POST',
            IMPORT_ROUTES.eventCandidatesPreview(eventId),
            candidateImportPlanSchema,
            fileBody(file),
          ),

        commitEventCandidates: (eventId: string, file: File): Promise<CandidateImportResult> =>
          write(
            'POST',
            IMPORT_ROUTES.eventCandidatesCommit(eventId),
            candidateImportResultSchema,
            fileBody(file),
          ),

        /** The program enrolment sample — a Blob, not an envelope. */
        programTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.programStudentsTemplate),

        /** Adds a program to students who already exist; a number we do not know is skipped. */
        previewProgramStudents: (code: string, file: File): Promise<ProgramImportPlan> =>
          write(
            'POST',
            IMPORT_ROUTES.programStudentsPreview(code),
            programImportPlanSchema,
            fileBody(file),
          ),

        commitProgramStudents: (code: string, file: File): Promise<ProgramImportResult> =>
          write(
            'POST',
            IMPORT_ROUTES.programStudentsCommit(code),
            programImportResultSchema,
            fileBody(file),
          ),
        /** The question workbook: Questions, Instructions, and the live taxonomy on Lists. */
        questionTemplate: (): Promise<Blob> => requestBlob(QUESTION_IMPORT_ROUTES.template),

        /**
         * Uploads once. The file is kept and an import run opened, so committing
         * names the run rather than sending the same megabytes a second time.
         */
        previewQuestions: (file: File): Promise<QuestionImportPlan> =>
          write('POST', QUESTION_IMPORT_ROUTES.preview, questionImportPlanSchema, fileBody(file)),

        commitQuestions: (importLogId: string): Promise<QuestionImportResult> =>
          write('POST', QUESTION_IMPORT_ROUTES.commit, questionImportResultSchema, {
            importLogId,
          }),
      },

      /** The landing screen. One payload, carrying only the bands the caller may see. */
      dashboard: {
        get: (): Promise<Dashboard> => get(ADMIN_DASHBOARD_ROUTES.get, dashboardSchema),
      },

      audit: {
        rowActions: (query: RowActionListQueryInput = {}): Promise<Paginated<RowAction>> =>
          list(ADMIN_AUDIT_ROUTES.rowActions, query, rowActionSchema),

        /** The sheet a run was fed — a Blob, not an envelope. */
        importFile: (id: string): Promise<Blob> => requestBlob(ADMIN_AUDIT_ROUTES.importFile(id)),

        imports: (query: PaginationQueryInput = {}): Promise<Paginated<ImportLogSummary>> =>
          list(ADMIN_AUDIT_ROUTES.imports, query, importLogSchema),
      },
    },
  };
}

/** One field, named once, so the server knows what to look for. */
function fileBody(file: File): FormData {
  const form = new FormData();
  form.append(IMPORT_FILE_FIELD, file);
  return form;
}

/** Reads a failure body. Outside the factory because it closes over nothing. */
const NO_CONTENT = 204;

/** The only answer that ends a session. A throttle, a 5xx or a dropped packet says nothing about it. */
const REFUSED = 401;

/** Halved and jittered: a hall whose tokens expired in the same minute must not ask again in step. */
const REFRESH_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

function refreshBackoffMs(asked: number, random: () => number = Math.random): number | undefined {
  const step = REFRESH_BACKOFF_MS[asked];
  return step === undefined ? undefined : step / 2 + random() * step;
}

function worthAskingAgain(failure: AppException | undefined): boolean {
  return failure?.httpStatus !== REFUSED;
}

/** A 204 never has a body (Express drops one), so it can only mean null; a schema that refuses null is a real mismatch. */
function noContentOf<T>(response: Response, schema: ZodType<T>): ApiSuccess<T> {
  const data = schema.safeParse(null);
  if (!data.success) {
    throw new AppException(ErrorCodes.INTERNAL, 'Unexpected response shape from API', {
      httpStatus: response.status,
      details: data.error.issues,
    });
  }
  return {
    success: true,
    data: data.data,
    meta: { requestId: response.headers.get(REQUEST_ID_HEADER) ?? '' },
  };
}

/** The typed failure a 401 carried, so a sign-out can say why. */
async function failureOf(response: Response): Promise<AppException | undefined> {
  const failed = await peekFailure(response);
  return failed ? AppException.fromFailure(failed, response.status) : undefined;
}

/** Why a request is over: a replacement names itself, else the 401 that sent it to refresh. */
function endedBy(
  refreshFailure: AppException | undefined,
  peeked: Awaited<ReturnType<typeof peekFailure>>,
): AppException {
  if (refreshFailure?.code === ErrorCodes.SESSION_REPLACED) return refreshFailure;
  // Never refused, only unreachable: say what actually went wrong rather than "sign in again".
  if (refreshFailure && worthAskingAgain(refreshFailure)) return refreshFailure;
  if (peeked) return AppException.fromFailure(peeked, 401);
  return new AppException(ErrorCodes.UNAUTHENTICATED, undefined, { httpStatus: 401 });
}

async function peekFailure(response: Response) {
  try {
    const parsed = apiFailureSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data : null;
  } catch {
    // A body that is not JSON at all is simply not an envelope.
    return null;
  }
}
