import { type ZodType } from 'zod';
import {
  AppException,
  ErrorCodes,
  apiFailureSchema,
  apiSuccessSchema,
  errorCodeForStatus,
  noContentSchema,
  type ApiSuccess,
  type NoContent,
  type Paginated,
  type PaginationQueryInput,
} from './envelope';
import {
  ADMIN_AUTHORING_ROUTES,
  authoringSaveResultSchema,
  authoringStatsSchema,
  authoringTagsSchema,
  type AuthoringHistoryQueryInput,
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
  otpRequestResponseSchema,
  pinSetupTicketSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
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
  type UpdateAdminInput,
} from './admins';
import { CSV_SEPARATOR } from './common';
import { healthResponseSchema, type HealthResponse } from './health';
import {
  DOCUMENT_FILE_FIELD,
  ME_ROUTES,
  consentStateSchema,
  consentStatusSchema,
  erasureReceiptSchema,
  studentDataExportSchema,
  type ConsentState,
  type ConsentStatus,
  type ErasureReceipt,
  type RecordConsentInput,
  type StudentDataExport,
  meSchema,
  type ChangePinInput,
  type DocumentKind,
  type Me,
  type UpdateMeInput,
} from './me';
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
  testSeriesSummarySchema,
  type SeriesBranch,
  type AddEventCandidatesInput,
  type CreateEventInput,
  type CreateProgramInput,
  type CreateTestSeriesInput,
  type Event,
  type EventCandidate,
  type EventCandidateListQueryInput,
  type EventListQueryInput,
  type GrantSeriesInput,
  type Program,
  type ProgramListQueryInput,
  notificationSchema,
  type Notification,
  type NotificationListQueryInput,
  studentCatalogSchema,
  type StudentCatalog,
  type StudentGrantRow,
  type StudentSeriesAccess,
  type TestSeriesListQueryInput,
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
  attemptAnalyticsSchema,
  performanceTrendSchema,
  scoreCardSchema,
  solutionReportSchema,
  liveAttemptSchema,
  liveAttemptStateSchema,
  submittedAttemptSchema,
  type ExamBrief,
  type ExamPaper,
  type LiveAttempt,
  type AttemptAnalytics,
  type PerformanceTrend,
  type ScoreCard,
  type SolutionReport,
  type SaveAttemptStateInput,
  type StartAttemptInput,
  type SubmittedAttempt,
  type LiveAttemptState,
} from './attempts';
import {
  OVERVIEW_ROUTES,
  PERFORMANCE_ROUTES,
  performanceReportSchema,
  practiceCalendarSchema,
  questionReportSchema,
  satSeriesListSchema,
  studentOverviewSchema,
  type PerformanceReport,
  type PracticeCalendar,
  type QuestionReport,
  type PerformanceReportQueryInput,
  type SatSeries,
  type StudentOverview,
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
  PERFORMANCE_SHARE_ROUTES,
  performanceShareSchema,
  performanceSharesSchema,
  sharedReportSchema,
  type CreatePerformanceShareInput,
  type PerformanceShare,
  type PerformanceShares,
  type SharedReport,
} from './shares';
import {
  ADMIN_TEST_PAPER_ROUTES,
  ADMIN_TEST_ROUTES,
  finalizeResultSchema,
  testDetailSchema,
  testPaperSchema,
  testSchema,
  offerResultSchema,
  seriesTestRowSchema,
  testProgramUnlockSchema,
  testScheduleSchema,
  testSeriesLinkSchema,
  testStatusSchema,
  type AddPaperQuestionInput,
  type ReplacePaperQuestionInput,
  type CreateTestInput,
  type FinalizeResult,
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
  type TestSchedule,
  type TestScheduleInput,
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
  bulkQuestionStatusResultSchema,
  QUESTION_IMAGE_FILE_FIELD,
  questionImageSchema,
  ADMIN_TAXONOMY_ROUTES,
  QUESTION_IMPORT_ROUTES,
  questionDetailSchema,
  questionImportPlanSchema,
  questionImportResultSchema,
  questionAvailabilitySchema,
  questionSummarySchema,
  subjectSchema,
  topicSchema,
  type CreateSubjectInput,
  type CreateTopicInput,
  type QuestionDetail,
  type BulkQuestionStatusInput,
  type BulkQuestionStatusResult,
  type QuestionImage,
  type QuestionDraftInput,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionIntakeStatus,
  type QuestionAvailability,
  type QuestionAvailabilityQueryInput,
  type QuestionListQueryInput,
  type QuestionSummary,
  type SetQuestionStatusInput,
  type Subject,
  type SubjectListQueryInput,
  type Topic,
  type TopicListQueryInput,
  type UpdateSubjectInput,
  type UpdateTopicInput,
} from './questions';

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

export interface ApiClientOptions {
  baseUrl: string;
  /** Current access token, or null when signed out. */
  getAccessToken: () => string | null;
  /** Current refresh token, or null when signed out. */
  getRefreshToken: () => string | null;
  /** Called after a successful silent refresh so the caller can persist rotation. */
  onTokensRefreshed?: (tokens: AuthTokens) => void;
  /** Called when the session is unrecoverable — the caller should sign out. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
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
    fetchImpl = globalThis.fetch,
  } = options;

  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

  /** Single-flight guard: many parallel 401s trigger exactly one refresh call. */
  let refreshInFlight: Promise<AuthTokens | null> | null = null;

  async function send(path: string, method: string, body: unknown, token: string | null) {
    // FormData: the browser must set its own Content-Type, boundary included.
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    try {
      return await fetchImpl(url(path), {
        method,
        headers: {
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
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const envelope = await parse(
        await send(AUTH_ROUTES.refresh, 'POST', { refreshToken }, null),
        authTokensSchema,
      );
      onTokensRefreshed?.(envelope.data);
      return envelope.data;
    } catch {
      // Refresh failing is a normal end-of-session, not an error to propagate.
      return null;
    }
  }

  async function envelopeOf<T>(path: string, opts: RequestOptions<T>): Promise<ApiSuccess<T>> {
    const { method = 'GET', body, schema, anonymous = false } = opts;

    if (anonymous) return parse(await send(path, method, body, null), schema);

    const response = await send(path, method, body, getAccessToken());
    if (response.status !== 401) return parse(response, schema);

    // Only an expired session is worth retrying: refreshing on a wrong PIN hides the real code.
    const peeked = await peekFailure(response);
    if (peeked && peeked.error.code !== 'UNAUTHENTICATED') {
      throw AppException.fromFailure(peeked, response.status);
    }

    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      onUnauthorized?.();
      throw peeked
        ? AppException.fromFailure(peeked, 401)
        : new AppException(ErrorCodes.UNAUTHENTICATED, undefined, { httpStatus: 401 });
    }

    const retried = await send(path, method, body, refreshed.accessToken);
    if (retried.status === 401) onUnauthorized?.();
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
        onUnauthorized?.();
        throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Your session has expired', {
          httpStatus: 401,
        });
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

  return {
    request,
    requestPaginated,
    requestBlob,

    health: (): Promise<HealthResponse> =>
      request('/health', { schema: healthResponseSchema, anonymous: true }),

    /** The one unauthenticated read of student data: a shared report, opened by its token. */
    sharedReport: (token: string): Promise<SharedReport> =>
      request(PERFORMANCE_SHARE_ROUTES.public(token), {
        schema: sharedReportSchema,
        anonymous: true,
      }),

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

      me: (): Promise<AuthIdentity> => request(AUTH_ROUTES.me, { schema: authIdentitySchema }),

      /** The envelope's `success` is the whole answer; there is no payload. */
      logout: (): Promise<NoContent> =>
        request(AUTH_ROUTES.logout, { method: 'POST', schema: noContentSchema }),
    },

    /** Admin-only. A student token gets 403 from every one of these. */
    /** The signed-in student's own account. No ids — the token is the subject. */
    me: {
      profile: (): Promise<Me> => request(ME_ROUTES.profile, { schema: meSchema }),

      consent: (): Promise<ConsentStatus> =>
        request(ME_ROUTES.consent, { schema: consentStatusSchema }),

      recordConsent: (input: RecordConsentInput): Promise<ConsentState> =>
        request(ME_ROUTES.consent, {
          method: 'POST',
          body: input,
          schema: consentStateSchema,
        }),

      dataExport: (): Promise<StudentDataExport> =>
        request(ME_ROUTES.dataExport, { schema: studentDataExportSchema }),

      erasure: (): Promise<ErasureReceipt> =>
        request(ME_ROUTES.erasure, { method: 'POST', schema: erasureReceiptSchema }),

      update: (input: UpdateMeInput): Promise<Me> =>
        request(ME_ROUTES.update, { method: 'PATCH', body: input, schema: meSchema }),

      /** Returns a FRESH session — the caller must store these tokens. */
      /** A photo or an identity document. Returns the refreshed profile. */
      uploadDocument: (kind: DocumentKind, file: File): Promise<Me> => {
        const form = new FormData();
        form.append(DOCUMENT_FILE_FIELD, file);
        return request(ME_ROUTES.document(kind), {
          method: 'POST',
          body: form,
          schema: meSchema,
        });
      },

      changePin: (input: ChangePinInput): Promise<AuthSessionResponse> =>
        request(ME_ROUTES.changePin, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
        }),

      /** Every series this student reaches, with what is open right now. */
      catalog: (): Promise<StudentCatalog> =>
        request(ME_ROUTES.catalog, { schema: studentCatalogSchema }),

      /** The bell, newest first. `meta.total` under `unreadOnly` is the count the header shows. */
      notifications: (query: NotificationListQueryInput = {}): Promise<Paginated<Notification>> =>
        requestPaginated(`${ME_ROUTES.notifications}${queryString({ ...query })}`, {
          schema: notificationSchema.array(),
        }),

      readNotification: (id: string): Promise<Notification> =>
        request(ME_ROUTES.readNotification(id), { method: 'PATCH', schema: notificationSchema }),

      /** What the student reads before the clock starts. */
      testBrief: (testId: string): Promise<ExamBrief> =>
        request(ME_ATTEMPT_ROUTES.brief(testId), { schema: examBriefSchema }),

      /** Idempotent: a second start while one is running resumes it, clock and all. */
      startAttempt: (testId: string, input: StartAttemptInput = {}): Promise<LiveAttempt> =>
        request(ME_ATTEMPT_ROUTES.start(testId), {
          method: 'POST',
          body: input,
          schema: liveAttemptSchema,
        }),

      /** The paper as a candidate sees it — it carries no answer. */
      attemptPaper: (attemptId: string): Promise<ExamPaper> =>
        request(ME_ATTEMPT_ROUTES.paper(attemptId), { schema: examPaperSchema }),

      /** The autosave. Batches what changed since the last one; the server merges and decides. */
      saveAttemptState: (
        attemptId: string,
        input: SaveAttemptStateInput,
      ): Promise<LiveAttemptState> =>
        request(ME_ATTEMPT_ROUTES.state(attemptId), {
          method: 'PATCH',
          body: input,
          schema: liveAttemptStateSchema,
        }),

      /** What the server is holding, so a reloaded tab can seed its answers instead of starting blank. */
      attemptState: (attemptId: string): Promise<LiveAttemptState> =>
        request(ME_ATTEMPT_ROUTES.state(attemptId), { schema: liveAttemptStateSchema }),

      /** Ends it. A second call reports the first one's outcome rather than refusing. */
      submitAttempt: (attemptId: string): Promise<SubmittedAttempt> =>
        request(ME_ATTEMPT_ROUTES.submit(attemptId), {
          method: 'POST',
          schema: submittedAttemptSchema,
        }),

      /** Marks, standing and their own answers. Refused until the paper has been marked. */
      scoreCard: (attemptId: string): Promise<ScoreCard> =>
        request(ME_ATTEMPT_ROUTES.scoreCard(attemptId), { schema: scoreCardSchema }),

      /** The worked solutions. Refused until the test has closed for everyone sitting it. */
      solutions: (attemptId: string): Promise<SolutionReport> =>
        request(ME_ATTEMPT_ROUTES.solutions(attemptId), { schema: solutionReportSchema }),

      /** Accuracy, time and strategy for one sitting, all derived from what the exam wrote. */
      analytics: (attemptId: string): Promise<AttemptAnalytics> =>
        request(ME_ATTEMPT_ROUTES.analytics(attemptId), { schema: attemptAnalyticsSchema }),

      /** Their paper question by question, beside the cohort's. The key rides the solution gate. */
      questionReport: (attemptId: string): Promise<QuestionReport> =>
        request(ME_ATTEMPT_ROUTES.questionReport(attemptId), { schema: questionReportSchema }),

      /** Every test this student has sat, oldest first. */
      performance: (): Promise<PerformanceTrend> =>
        request(ME_ATTEMPT_ROUTES.performance, { schema: performanceTrendSchema }),

      /** Sitting counts by institute day, for the calendar the trend's twenty cannot fill. */
      practiceDays: (): Promise<PracticeCalendar> =>
        request(ME_ATTEMPT_ROUTES.practiceDays, { schema: practiceCalendarSchema }),

      /** The cutoff-free metric set for one sitting, one paper, one series or the whole career. */
      performanceReport: (query: PerformanceReportQueryInput): Promise<PerformanceReport> =>
        request(`${PERFORMANCE_ROUTES.me}${queryString({ ...query })}`, {
          schema: performanceReportSchema,
        }),

      /** Every series they have sat a test in — the SERIES scope has nothing else to offer. */
      performanceSeries: (): Promise<SatSeries[]> =>
        request(PERFORMANCE_ROUTES.mySeries, { schema: satSeriesListSchema }),

      /** Their whole career off the two rollup tables: standing, disposition and subjects. */
      overview: (): Promise<StudentOverview> =>
        request(OVERVIEW_ROUTES.me, { schema: studentOverviewSchema }),

      /** The board, for a signed-in reader only. Never call this from an unauthenticated screen. */
      leaderboard: (query: LeaderboardQueryInput): Promise<Leaderboard> =>
        request(`${LEADERBOARD_ROUTES.me}${queryString({ ...query })}`, {
          schema: leaderboardSchema,
        }),

      /** Their own links, live and dead, and the sittings a new one could open. */
      performanceShares: (): Promise<PerformanceShares> =>
        request(PERFORMANCE_SHARE_ROUTES.mine, { schema: performanceSharesSchema }),

      sharePerformance: (input: CreatePerformanceShareInput): Promise<PerformanceShare> =>
        request(PERFORMANCE_SHARE_ROUTES.mine, {
          method: 'POST',
          body: input,
          schema: performanceShareSchema,
        }),

      revokePerformanceShare: (id: string): Promise<PerformanceShare> =>
        request(PERFORMANCE_SHARE_ROUTES.revokeMine(id), {
          method: 'POST',
          schema: performanceShareSchema,
        }),
    },

    admin: {
      /** Watching one test's sittings, and resolving the ones that broke. */
      liveOps: {
        tests: (query: LiveOpsTestQueryInput = {}): Promise<Paginated<LiveOpsTest>> =>
          requestPaginated(`${ADMIN_LIVE_OPS_ROUTES.tests}${queryString({ ...query })}`, {
            schema: liveOpsTestSchema.array(),
          }),

        board: (testId: string): Promise<LiveOpsBoard> =>
          request(ADMIN_LIVE_OPS_ROUTES.board(testId), { schema: liveOpsBoardSchema }),

        forceSubmit: (
          attemptId: string,
          input: ForceSubmitAttemptInput,
        ): Promise<ResolvedAttempt> =>
          request(ADMIN_LIVE_OPS_ROUTES.forceSubmit(attemptId), {
            method: 'POST',
            body: input,
            schema: resolvedAttemptSchema,
          }),

        extend: (attemptId: string, input: ExtendAttemptInput): Promise<ResolvedAttempt> =>
          request(ADMIN_LIVE_OPS_ROUTES.extend(attemptId), {
            method: 'POST',
            body: input,
            schema: resolvedAttemptSchema,
          }),

        reset: (attemptId: string, input: ResetAttemptInput): Promise<ResolvedAttempt> =>
          request(ADMIN_LIVE_OPS_ROUTES.reset(attemptId), {
            method: 'POST',
            body: input,
            schema: resolvedAttemptSchema,
          }),

        void: (attemptId: string, input: VoidAttemptInput): Promise<ResolvedAttempt> =>
          request(ADMIN_LIVE_OPS_ROUTES.void(attemptId), {
            method: 'POST',
            body: input,
            schema: resolvedAttemptSchema,
          }),
      },

      /** What an admin says to a cohort, and what reaching them cost. */
      announcements: {
        list: (query: AnnouncementListQueryInput = {}): Promise<Paginated<AnnouncementSummary>> =>
          requestPaginated(`${ANNOUNCEMENT_ROUTES.list}${queryString({ ...query })}`, {
            schema: announcementSummarySchema.array(),
          }),

        /** Asked while composing. Changes nothing — the cohort is read off the body. */
        preview: (input: CreateAnnouncementInput): Promise<AnnouncementPreview> =>
          request(ANNOUNCEMENT_ROUTES.preview, {
            method: 'POST',
            body: input,
            schema: announcementPreviewSchema,
          }),

        send: (input: CreateAnnouncementInput): Promise<Announcement> =>
          request(ANNOUNCEMENT_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: announcementSchema,
          }),

        detail: (id: string): Promise<Announcement> =>
          request(ANNOUNCEMENT_ROUTES.detail(id), { schema: announcementSchema }),
      },

      students: {
        list: (query: StudentListQueryInput = {}): Promise<Paginated<StudentSummary>> =>
          requestPaginated(`${ADMIN_STUDENT_ROUTES.list}${queryString({ ...query })}`, {
            schema: studentSummarySchema.array(),
          }),

        detail: (id: string): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.detail(id), { schema: studentDetailSchema }),

        create: (input: CreateStudentInput): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: studentDetailSchema,
          }),

        update: (id: string, input: UpdateStudentInput): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: studentDetailSchema,
          }),

        setActive: (id: string, isActive: boolean): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.setActive(id), {
            method: 'PATCH',
            body: { isActive },
            schema: studentDetailSchema,
          }),

        setTestBlocked: (id: string, input: SetStudentTestBlockedBody): Promise<StudentDetail> =>
          request(ADMIN_STUDENT_ROUTES.setTestBlocked(id), {
            method: 'PATCH',
            body: input,
            schema: studentDetailSchema,
          }),

        /** Any student's analytics, behind STUDENT_PERFORMANCE. Same payload the student reads. */
        performance: (id: string, query: PerformanceReportQueryInput): Promise<PerformanceReport> =>
          request(`${PERFORMANCE_ROUTES.ofStudent(id)}${queryString({ ...query })}`, {
            schema: performanceReportSchema,
          }),

        questionReport: (id: string, attemptId: string): Promise<QuestionReport> =>
          request(PERFORMANCE_ROUTES.questionReportOfStudent(id, attemptId), {
            schema: questionReportSchema,
          }),

        /** The same overall dashboard payload the student reads, behind STUDENT_PERFORMANCE. */
        overview: (id: string): Promise<StudentOverview> =>
          request(OVERVIEW_ROUTES.ofStudent(id), { schema: studentOverviewSchema }),

        performanceShares: (id: string): Promise<PerformanceShares> =>
          request(PERFORMANCE_SHARE_ROUTES.ofStudent(id), { schema: performanceSharesSchema }),

        sharePerformance: (
          id: string,
          input: CreatePerformanceShareInput,
        ): Promise<PerformanceShare> =>
          request(PERFORMANCE_SHARE_ROUTES.ofStudent(id), {
            method: 'POST',
            body: input,
            schema: performanceShareSchema,
          }),

        revokePerformanceShare: (id: string, shareId: string): Promise<PerformanceShare> =>
          request(PERFORMANCE_SHARE_ROUTES.revokeOfStudent(id, shareId), {
            method: 'POST',
            schema: performanceShareSchema,
          }),
      },

      /** Super admin only, enforced server-side. The client does not re-state it. */
      admins: {
        list: (query: AdminListQueryInput = {}): Promise<Paginated<Admin>> =>
          requestPaginated(`${ADMIN_ADMIN_ROUTES.list}${queryString({ ...query })}`, {
            schema: adminSchema.array(),
          }),

        create: (input: CreateAdminInput): Promise<Admin> =>
          request(ADMIN_ADMIN_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: adminSchema,
          }),

        update: (id: string, input: UpdateAdminInput): Promise<Admin> =>
          request(ADMIN_ADMIN_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: adminSchema,
          }),

        /** Deactivating prunes every grant. Reactivating does NOT restore them. */
        setActive: (id: string, isActive: boolean): Promise<Admin> =>
          request(ADMIN_ADMIN_ROUTES.setActive(id), {
            method: 'PATCH',
            body: { isActive },
            schema: adminSchema,
          }),
      },

      features: {
        list: (): Promise<Feature[]> =>
          request(ADMIN_FEATURE_ROUTES.list, { schema: featureSchema.array() }),

        grant: (input: PermissionGrantInput): Promise<Feature> =>
          request(ADMIN_FEATURE_ROUTES.grant, {
            method: 'POST',
            body: input,
            schema: featureSchema,
          }),

        revoke: (input: PermissionGrantBody): Promise<Feature> =>
          request(ADMIN_FEATURE_ROUTES.revoke(input.featureKey, input.level, input.adminId), {
            method: 'DELETE',
            schema: featureSchema,
          }),
      },

      branches: {
        list: (query: BranchListQueryInput = {}): Promise<Paginated<Branch>> =>
          requestPaginated(`${ADMIN_BRANCH_ROUTES.list}${queryString({ ...query })}`, {
            schema: branchSchema.array(),
          }),

        create: (input: CreateBranchInput): Promise<Branch> =>
          request(ADMIN_BRANCH_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: branchSchema,
          }),

        update: (id: string, input: UpdateBranchInput): Promise<Branch> =>
          request(ADMIN_BRANCH_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: branchSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_BRANCH_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),
      },

      exams: {
        list: (query: ExamListQueryInput = {}): Promise<Paginated<Exam>> =>
          requestPaginated(`${ADMIN_EXAM_ROUTES.list}${queryString({ ...query })}`, {
            schema: examSchema.array(),
          }),

        create: (input: CreateExamInput): Promise<Exam> =>
          request(ADMIN_EXAM_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: examSchema,
          }),

        update: (id: string, input: UpdateExamInput): Promise<Exam> =>
          request(ADMIN_EXAM_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: examSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_EXAM_ROUTES.remove(id), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /** The stage layer: what a base config, a series and a test all hang off. */
      examStages: {
        list: (query: ExamStageListQueryInput = {}): Promise<Paginated<ExamStage>> =>
          requestPaginated(`${ADMIN_EXAM_STAGE_ROUTES.list}${queryString({ ...query })}`, {
            schema: examStageSchema.array(),
          }),

        create: (input: CreateExamStageInput): Promise<ExamStage> =>
          request(ADMIN_EXAM_STAGE_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: examStageSchema,
          }),

        update: (id: string, input: UpdateExamStageInput): Promise<ExamStage> =>
          request(ADMIN_EXAM_STAGE_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: examStageSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_EXAM_STAGE_ROUTES.remove(id), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /** The coaching variants a student can be a candidate for. */
      programs: {
        list: (query: ProgramListQueryInput = {}): Promise<Paginated<Program>> =>
          requestPaginated(`${ADMIN_PROGRAM_ROUTES.list}${queryString({ ...query })}`, {
            schema: programCatalogSchema.array(),
          }),

        create: (input: CreateProgramInput): Promise<Program> =>
          request(ADMIN_PROGRAM_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: programCatalogSchema,
          }),

        update: (id: string, input: UpdateProgramInput): Promise<Program> =>
          request(ADMIN_PROGRAM_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: programCatalogSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_PROGRAM_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),
      },

      /** Who an EVENT series reaches — sitters, not necessarily students yet. */
      events: {
        list: (query: EventListQueryInput = {}): Promise<Paginated<Event>> =>
          requestPaginated(`${EVENT_ROUTES.list}${queryString({ ...query })}`, {
            schema: eventSchema.array(),
          }),

        detail: (id: string): Promise<Event> =>
          request(EVENT_ROUTES.detail(id), { schema: eventSchema }),

        create: (input: CreateEventInput): Promise<Event> =>
          request(EVENT_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: eventSchema,
          }),

        update: (id: string, input: UpdateEventInput): Promise<Event> =>
          request(EVENT_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: eventSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(EVENT_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),

        candidates: (
          id: string,
          query: EventCandidateListQueryInput = {},
        ): Promise<Paginated<EventCandidate>> =>
          requestPaginated(`${EVENT_ROUTES.candidates(id)}${queryString({ ...query })}`, {
            schema: eventCandidateSchema.array(),
          }),

        addCandidates: (id: string, input: AddEventCandidatesInput): Promise<EventCandidate[]> =>
          request(EVENT_ROUTES.addCandidates(id), {
            method: 'POST',
            body: input,
            schema: eventCandidateSchema.array(),
          }),

        removeCandidate: (id: string, studentId: string): Promise<NoContent> =>
          request(EVENT_ROUTES.removeCandidate(id, studentId), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /** The unit of offering. A test reaches a student only through one of these. */
      testSeries: {
        list: (query: TestSeriesListQueryInput = {}): Promise<Paginated<TestSeriesSummary>> =>
          requestPaginated(`${ADMIN_SERIES_ROUTES.list}${queryString({ ...query })}`, {
            schema: testSeriesSummarySchema.array(),
          }),

        detail: (id: string): Promise<TestSeriesSummary> =>
          request(ADMIN_SERIES_ROUTES.detail(id), { schema: testSeriesSummarySchema }),

        create: (input: CreateTestSeriesInput): Promise<TestSeriesSummary> =>
          request(ADMIN_SERIES_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: testSeriesSummarySchema,
          }),

        update: (id: string, input: UpdateTestSeriesInput): Promise<TestSeriesSummary> =>
          request(ADMIN_SERIES_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: testSeriesSummarySchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_SERIES_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),

        /** Every branch, and whether this series reaches it, scoped to what the caller may see. */
        branches: (id: string): Promise<SeriesBranch[]> =>
          request(ADMIN_SERIES_ROUTES.branches(id), { schema: seriesBranchSchema.array() }),

        setBranches: (id: string, input: UpdateSeriesBranchesInput): Promise<SeriesBranch[]> =>
          request(ADMIN_SERIES_ROUTES.branches(id), {
            method: 'PUT',
            body: input,
            schema: seriesBranchSchema.array(),
          }),

        tests: (id: string): Promise<SeriesTestRow[]> =>
          request(ADMIN_SERIES_ROUTES.tests(id), { schema: seriesTestRowSchema.array() }),

        setTestUnlock: (
          id: string,
          testId: string,
          input: SetSeriesTestUnlockInput,
        ): Promise<SeriesTestRow[]> =>
          request(ADMIN_SERIES_ROUTES.test(id, testId), {
            method: 'PATCH',
            body: input,
            schema: seriesTestRowSchema.array(),
          }),
      },

      /** Every series a student reaches and what opens each one, the branch gate already applied. */
      studentSeries: {
        list: (studentId: string): Promise<StudentSeriesAccess[]> =>
          request(ADMIN_STUDENT_SERIES_ROUTES.list(studentId), {
            schema: studentSeriesAccessSchema.array(),
          }),
      },

      /** The escape hatch, filed against the student it was made about. */
      grants: {
        list: (studentId: string): Promise<StudentGrantRow[]> =>
          request(ADMIN_GRANT_ROUTES.list(studentId), { schema: studentGrantRowSchema.array() }),

        create: (studentId: string, input: GrantSeriesInput): Promise<StudentGrantRow[]> =>
          request(ADMIN_GRANT_ROUTES.create(studentId), {
            method: 'POST',
            body: input,
            schema: studentGrantRowSchema.array(),
          }),

        remove: (studentId: string, testSeriesId: string): Promise<NoContent> =>
          request(ADMIN_GRANT_ROUTES.remove(studentId, testSeriesId), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /** A stage's blueprints. The shape freezes at the first finalize — clone to evolve. */
      baseConfigs: {
        list: (query: BaseConfigListQueryInput = {}): Promise<Paginated<BaseConfig>> =>
          requestPaginated(`${ADMIN_BASE_CONFIG_ROUTES.list}${queryString({ ...query })}`, {
            schema: baseConfigSchema.array(),
          }),

        detail: (id: string): Promise<BaseConfigDetail> =>
          request(ADMIN_BASE_CONFIG_ROUTES.detail(id), { schema: baseConfigDetailSchema }),

        create: (input: CreateBaseConfigInput): Promise<BaseConfigDetail> =>
          request(ADMIN_BASE_CONFIG_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: baseConfigDetailSchema,
          }),

        update: (id: string, input: UpdateBaseConfigInput): Promise<BaseConfigDetail> =>
          request(ADMIN_BASE_CONFIG_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: baseConfigDetailSchema,
          }),

        clone: (id: string, input: CloneBaseConfigInput = {}): Promise<BaseConfigDetail> =>
          request(ADMIN_BASE_CONFIG_ROUTES.clone(id), {
            method: 'POST',
            body: input,
            schema: baseConfigDetailSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_BASE_CONFIG_ROUTES.remove(id), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /** The tests built from a config. Every shape field is read through it, never copied. */
      tests: {
        list: (query: TestListQueryInput = {}): Promise<Paginated<Test>> =>
          requestPaginated(`${ADMIN_TEST_ROUTES.list}${queryString({ ...query })}`, {
            schema: testSchema.array(),
          }),

        detail: (id: string): Promise<TestDetail> =>
          request(ADMIN_TEST_ROUTES.detail(id), { schema: testDetailSchema }),

        create: (input: CreateTestInput): Promise<TestDetail> =>
          request(ADMIN_TEST_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: testDetailSchema,
          }),

        update: (id: string, input: UpdateTestInput): Promise<TestDetail> =>
          request(ADMIN_TEST_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: testDetailSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_TEST_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),

        /** The draft paper, as it stands: drawn at finalize, then edited a question at a time. */
        readPaper: (id: string, variant?: number): Promise<TestPaper> =>
          request(`${ADMIN_TEST_PAPER_ROUTES.read(id)}${queryString({ variant })}`, {
            schema: testPaperSchema,
          }),

        /** Several at once, in the next free places its section has. */
        addPaperQuestions: (id: string, input: AddPaperQuestionInput): Promise<TestPaper> =>
          request(ADMIN_TEST_PAPER_ROUTES.addQuestion(id), {
            method: 'POST',
            body: input,
            schema: testPaperSchema,
          }),

        /** One row of it, so a paper right but for a single question is not redrawn whole. */
        replacePaperQuestion: (
          id: string,
          rowId: string,
          input: ReplacePaperQuestionInput,
        ): Promise<TestPaper> =>
          request(ADMIN_TEST_PAPER_ROUTES.replaceQuestion(id, rowId), {
            method: 'PATCH',
            body: input,
            schema: testPaperSchema,
          }),

        removePaperQuestions: (id: string, rowIds: readonly string[]): Promise<TestPaper> =>
          request(
            `${ADMIN_TEST_PAPER_ROUTES.removeQuestions(id)}${queryString({ rowIds: [...rowIds] })}`,
            { method: 'DELETE', schema: testPaperSchema },
          ),

        /** Fills the rest of one section from its own spec; every hand-picked row keeps its place. */
        fillPaperSection: (id: string, sectionId: string): Promise<TestPaper> =>
          request(ADMIN_TEST_PAPER_ROUTES.fillSection(id, sectionId), {
            method: 'POST',
            schema: testPaperSchema,
          }),

        /** Drops a question or makes it a bonus, and re-scores every sitting that served it. */
        setPaperQuestionStatus: (
          id: string,
          rowId: string,
          input: SetPaperQuestionStatusInput,
        ): Promise<TestPaper> =>
          request(ADMIN_TEST_PAPER_ROUTES.questionStatus(id, rowId), {
            method: 'PATCH',
            body: input,
            schema: testPaperSchema,
          }),

        /** Idempotent: a second call reports the first one's outcome rather than freezing twice. */
        finalize: (id: string): Promise<FinalizeResult> =>
          request(ADMIN_TEST_PAPER_ROUTES.finalize(id), {
            method: 'POST',
            schema: finalizeResultSchema,
          }),

        series: (id: string): Promise<TestSeriesLink> =>
          request(ADMIN_TEST_PAPER_ROUTES.series(id), { schema: testSeriesLinkSchema }),

        offer: (id: string): Promise<OfferResult> =>
          request(ADMIN_TEST_PAPER_ROUTES.offer(id), { method: 'POST', schema: offerResultSchema }),

        /** The test's own late entry and extra time. Both null is the plain rules. */
        setSchedule: (id: string, input: TestScheduleInput): Promise<TestSchedule> =>
          request(ADMIN_TEST_PAPER_ROUTES.schedule(id), {
            method: 'PUT',
            body: input,
            schema: testScheduleSchema,
          }),

        moveToSeries: (id: string, input: SetTestSeriesInput): Promise<TestSeriesLink> =>
          request(ADMIN_TEST_PAPER_ROUTES.series(id), {
            method: 'POST',
            body: input,
            schema: testSeriesLinkSchema,
          }),

        setStatus: (id: string, input: SetTestStatusInput): Promise<TestStatus> =>
          request(ADMIN_TEST_PAPER_ROUTES.setStatus(id), {
            method: 'PATCH',
            body: input,
            schema: testStatusSchema,
          }),

        /** A program opens a test EARLIER; entry still closes when it closes for everyone. */
        setProgramUnlock: (
          id: string,
          programCode: string,
          input: SetProgramUnlockInput,
        ): Promise<TestProgramUnlock[]> =>
          request(ADMIN_TEST_PAPER_ROUTES.programUnlock(id, programCode), {
            method: 'PUT',
            body: input,
            schema: testProgramUnlockSchema.array(),
          }),

        clearProgramUnlock: (id: string, programCode: string): Promise<TestProgramUnlock[]> =>
          request(ADMIN_TEST_PAPER_ROUTES.programUnlock(id, programCode), {
            method: 'DELETE',
            schema: testProgramUnlockSchema.array(),
          }),
      },

      /** Subject -> Topic. Anything finer than a topic is a `topic:` tag on the question. */
      taxonomy: {
        listSubjects: (query: SubjectListQueryInput = {}): Promise<Paginated<Subject>> =>
          requestPaginated(`${ADMIN_TAXONOMY_ROUTES.subjects}${queryString({ ...query })}`, {
            schema: subjectSchema.array(),
          }),

        createSubject: (input: CreateSubjectInput): Promise<Subject> =>
          request(ADMIN_TAXONOMY_ROUTES.subjects, {
            method: 'POST',
            body: input,
            schema: subjectSchema,
          }),

        updateSubject: (id: string, input: UpdateSubjectInput): Promise<Subject> =>
          request(ADMIN_TAXONOMY_ROUTES.subject(id), {
            method: 'PATCH',
            body: input,
            schema: subjectSchema,
          }),

        listTopics: (query: TopicListQueryInput = {}): Promise<Paginated<Topic>> =>
          requestPaginated(`${ADMIN_TAXONOMY_ROUTES.topics}${queryString({ ...query })}`, {
            schema: topicSchema.array(),
          }),

        createTopic: (input: CreateTopicInput): Promise<Topic> =>
          request(ADMIN_TAXONOMY_ROUTES.topics, {
            method: 'POST',
            body: input,
            schema: topicSchema,
          }),

        updateTopic: (id: string, input: UpdateTopicInput): Promise<Topic> =>
          request(ADMIN_TAXONOMY_ROUTES.topic(id), {
            method: 'PATCH',
            body: input,
            schema: topicSchema,
          }),
      },

      /** A typist's own questions. Every route here is scoped to the caller by the server. */
      authoring: {
        /** The author's own recent tags, newest first — what the header offers as they type. */
        tags: (): Promise<string[]> =>
          request(ADMIN_AUTHORING_ROUTES.tags, { schema: authoringTagsSchema }).then(
            (result) => result.tags,
          ),

        stats: (): Promise<AuthoringStats> =>
          request(ADMIN_AUTHORING_ROUTES.stats, { schema: authoringStatsSchema }),

        history: (query: AuthoringHistoryQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
          requestPaginated(`${ADMIN_AUTHORING_ROUTES.history}${queryString({ ...query })}`, {
            schema: questionSummarySchema.array(),
          }),

        detail: (id: string): Promise<QuestionDetail> =>
          request(ADMIN_AUTHORING_ROUTES.get(id), { schema: questionDetailSchema }),

        create: (input: QuestionDraftInput): Promise<AuthoringSaveResult> =>
          request(ADMIN_AUTHORING_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: authoringSaveResultSchema,
          }),

        update: (id: string, input: QuestionDraftInput): Promise<AuthoringSaveResult> =>
          request(ADMIN_AUTHORING_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: authoringSaveResultSchema,
          }),
      },

      questions: {
        list: (query: QuestionListQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
          requestPaginated(`${ADMIN_QUESTION_ROUTES.list}${queryString({ ...query })}`, {
            schema: questionSummarySchema.array(),
          }),

        detail: (id: string): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.get(id), { schema: questionDetailSchema }),

        /** Counts, not a page: what a section can actually be drawn from. */
        availability: (query: QuestionAvailabilityQueryInput = {}): Promise<QuestionAvailability> =>
          request(`${ADMIN_QUESTION_ROUTES.availability}${queryString({ ...query })}`, {
            schema: questionAvailabilitySchema,
          }),

        create: (input: QuestionDraftInput): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: questionDetailSchema,
          }),

        update: (id: string, input: QuestionDraftInput): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: questionDetailSchema,
          }),

        /** ARCHIVED retires a question: it is drawn into no future paper. */
        setStatus: (id: string, input: SetQuestionStatusInput): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.setStatus(id), {
            method: 'PATCH',
            body: input,
            schema: questionDetailSchema,
          }),

        /** The soft remove: out of circulation and out of the bank, losing nothing. */
        archive: (id: string): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.archive(id), {
            method: 'POST',
            schema: questionDetailSchema,
          }),

        unarchive: (id: string): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.unarchive(id), {
            method: 'POST',
            schema: questionDetailSchema,
          }),

        /** Only a draft nothing has drawn. Everything else is archived, never removed. */
        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_QUESTION_ROUTES.remove(id), {
            method: 'DELETE',
            schema: noContentSchema,
          }),

        /** One decision over a page of drafts — one request, so nothing is half-approved. */
        bulkSetStatus: (input: BulkQuestionStatusInput): Promise<BulkQuestionStatusResult> =>
          request(ADMIN_QUESTION_ROUTES.bulkStatus, {
            method: 'PATCH',
            body: input,
            schema: bulkQuestionStatusResultSchema,
          }),

        /** Content stores the `key`; the `url` is for showing the image that was just chosen. */
        uploadImage: (file: File): Promise<QuestionImage> => {
          const form = new FormData();
          form.append(QUESTION_IMAGE_FILE_FIELD, file);
          return request(ADMIN_QUESTION_ROUTES.uploadImage, {
            method: 'POST',
            body: form,
            schema: questionImageSchema,
          });
        },
      },

      imports: {
        /** The sample workbook — a Blob, not an envelope. */
        studentTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.studentsTemplate),

        /** Writes nothing — this is what the admin reads before committing. */
        previewStudents: (file: File): Promise<StudentImportPlan> =>
          request(IMPORT_ROUTES.studentsPreview, {
            method: 'POST',
            body: fileBody(file),
            schema: studentImportPlanSchema,
          }),

        commitStudents: (file: File): Promise<StudentImportResult> =>
          request(IMPORT_ROUTES.studentsCommit, {
            method: 'POST',
            body: fileBody(file),
            schema: studentImportResultSchema,
          }),

        /** The candidate sample — a Blob, not an envelope. */
        candidateTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.candidatesTemplate),

        /** An event intake: an existing number joins the roster and nothing about them is edited. */
        previewEventCandidates: (eventId: string, file: File): Promise<CandidateImportPlan> =>
          request(IMPORT_ROUTES.eventCandidatesPreview(eventId), {
            method: 'POST',
            body: fileBody(file),
            schema: candidateImportPlanSchema,
          }),

        commitEventCandidates: (eventId: string, file: File): Promise<CandidateImportResult> =>
          request(IMPORT_ROUTES.eventCandidatesCommit(eventId), {
            method: 'POST',
            body: fileBody(file),
            schema: candidateImportResultSchema,
          }),

        /** The program enrolment sample — a Blob, not an envelope. */
        programTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.programStudentsTemplate),

        /** Adds a program to students who already exist; a number we do not know is skipped. */
        previewProgramStudents: (code: string, file: File): Promise<ProgramImportPlan> =>
          request(IMPORT_ROUTES.programStudentsPreview(code), {
            method: 'POST',
            body: fileBody(file),
            schema: programImportPlanSchema,
          }),

        commitProgramStudents: (code: string, file: File): Promise<ProgramImportResult> =>
          request(IMPORT_ROUTES.programStudentsCommit(code), {
            method: 'POST',
            body: fileBody(file),
            schema: programImportResultSchema,
          }),

        /** No body: the roster is fetched server-side, so there is nothing here to tamper with. */
        previewPortalStudents: (): Promise<StudentImportPlan> =>
          request(IMPORT_ROUTES.studentsPortalPreview, {
            method: 'POST',
            schema: studentImportPlanSchema,
          }),

        commitPortalStudents: (): Promise<StudentImportResult> =>
          request(IMPORT_ROUTES.studentsPortalCommit, {
            method: 'POST',
            schema: studentImportResultSchema,
          }),
        /** The question workbook: Questions, Instructions, and the live taxonomy on Lists. */
        questionTemplate: (): Promise<Blob> => requestBlob(QUESTION_IMPORT_ROUTES.template),

        /**
         * Uploads once. The file is kept and an import run opened, so committing
         * names the run rather than sending the same megabytes a second time.
         */
        previewQuestions: (file: File): Promise<QuestionImportPlan> =>
          request(QUESTION_IMPORT_ROUTES.preview, {
            method: 'POST',
            body: fileBody(file),
            schema: questionImportPlanSchema,
          }),

        commitQuestions: (
          importLogId: string,
          status: QuestionIntakeStatus,
        ): Promise<QuestionImportResult> =>
          request(QUESTION_IMPORT_ROUTES.commit, {
            method: 'POST',
            body: { importLogId, status },
            schema: questionImportResultSchema,
          }),
      },

      audit: {
        rowActions: (query: RowActionListQueryInput = {}): Promise<Paginated<RowAction>> =>
          requestPaginated(`${ADMIN_AUDIT_ROUTES.rowActions}${queryString({ ...query })}`, {
            schema: rowActionSchema.array(),
          }),

        /** The sheet a run was fed — a Blob, not an envelope. */
        importFile: (id: string): Promise<Blob> => requestBlob(ADMIN_AUDIT_ROUTES.importFile(id)),

        imports: (query: PaginationQueryInput = {}): Promise<Paginated<ImportLogSummary>> =>
          requestPaginated(`${ADMIN_AUDIT_ROUTES.imports}${queryString({ ...query })}`, {
            schema: importLogSchema.array(),
          }),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** One field, named once, so the server knows what to look for. */
function fileBody(file: File): FormData {
  const form = new FormData();
  form.append(IMPORT_FILE_FIELD, file);
  return form;
}

/** Reads a failure body. Outside the factory because it closes over nothing. */
async function peekFailure(response: Response) {
  try {
    const parsed = apiFailureSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data : null;
  } catch {
    // A body that is not JSON at all is simply not an envelope.
    return null;
  }
}
