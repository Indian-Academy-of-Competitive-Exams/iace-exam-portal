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
  ADMIN_SYNC_ROUTES,
  adminSchema,
  featureSchema,
  studentSyncResultSchema,
  type Admin,
  type AdminListQueryInput,
  type CreateAdminInput,
  type CreateFeatureInput,
  type Feature,
  type PermissionGrantBody,
  type PermissionGrantInput,
  type StudentSyncResult,
  type UpdateAdminInput,
} from './admins';
import { healthResponseSchema, type HealthResponse } from './health';
import {
  DOCUMENT_FILE_FIELD,
  ME_ROUTES,
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
  ADMIN_EXAM_TYPE_ROUTES,
  examTypeSchema,
  type CreateExamTypeInput,
  type ExamType,
  type ExamTypeListQueryInput,
  type UpdateExamTypeInput,
} from './exam-types';
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
  ADMIN_GROUP_ROUTES,
  addGroupMembersResultSchema,
  groupSummarySchema,
  type AddGroupMembersInput,
  type AddGroupMembersResult,
  type CreateGroupInput,
  type GroupListQueryInput,
  type GroupSummary,
  type UpdateGroupInput,
} from './groups';
import {
  GROUP_IMPORT_ROUTES,
  IMPORT_FILE_FIELD,
  IMPORT_ROUTES,
  groupMemberImportPlanSchema,
  groupMemberImportResultSchema,
  type GroupMemberImportPlan,
  type GroupMemberImportResult,
  studentImportPlanSchema,
  studentImportResultSchema,
  type StudentImportPlan,
  type StudentImportResult,
} from './imports';

import {
  ADMIN_QUESTION_ROUTES,
  ADMIN_TAXONOMY_ROUTES,
  QUESTION_IMPORT_ROUTES,
  questionDetailSchema,
  questionImportPlanSchema,
  questionImportResultSchema,
  questionSummarySchema,
  subTopicSchema,
  subjectSchema,
  topicSchema,
  type CreateSubTopicInput,
  type CreateSubjectInput,
  type CreateTopicInput,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionListQueryInput,
  type QuestionSummary,
  type SetQuestionActiveInput,
  type SetQuestionStatusInput,
  type SubTopic,
  type SubTopicListQueryInput,
  type Subject,
  type SubjectListQueryInput,
  type Topic,
  type TopicListQueryInput,
  type UpdateSubTopicInput,
  type UpdateSubjectInput,
  type UpdateTopicInput,
} from './questions';

/** Drops empty and undefined keys, so an unset filter never becomes `?q=undefined`. */
function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
    },

    admin: {
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

        create: (input: CreateFeatureInput): Promise<Feature> =>
          request(ADMIN_FEATURE_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: featureSchema,
          }),

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

      sync: {
        /** Stubbed server-side — the plumbing is finished, the fetch is not. */
        students: (): Promise<StudentSyncResult> =>
          request(ADMIN_SYNC_ROUTES.students, {
            method: 'POST',
            schema: studentSyncResultSchema,
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

      examTypes: {
        list: (query: ExamTypeListQueryInput = {}): Promise<Paginated<ExamType>> =>
          requestPaginated(`${ADMIN_EXAM_TYPE_ROUTES.list}${queryString({ ...query })}`, {
            schema: examTypeSchema.array(),
          }),

        create: (input: CreateExamTypeInput): Promise<ExamType> =>
          request(ADMIN_EXAM_TYPE_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: examTypeSchema,
          }),

        update: (id: string, input: UpdateExamTypeInput): Promise<ExamType> =>
          request(ADMIN_EXAM_TYPE_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: examTypeSchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_EXAM_TYPE_ROUTES.remove(id), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      groups: {
        list: (query: GroupListQueryInput = {}): Promise<Paginated<GroupSummary>> =>
          requestPaginated(`${ADMIN_GROUP_ROUTES.list}${queryString({ ...query })}`, {
            schema: groupSummarySchema.array(),
          }),

        detail: (id: string): Promise<GroupSummary> =>
          request(ADMIN_GROUP_ROUTES.detail(id), { schema: groupSummarySchema }),

        create: (input: CreateGroupInput): Promise<GroupSummary> =>
          request(ADMIN_GROUP_ROUTES.create, {
            method: 'POST',
            body: input,
            schema: groupSummarySchema,
          }),

        update: (id: string, input: UpdateGroupInput): Promise<GroupSummary> =>
          request(ADMIN_GROUP_ROUTES.update(id), {
            method: 'PATCH',
            body: input,
            schema: groupSummarySchema,
          }),

        remove: (id: string): Promise<NoContent> =>
          request(ADMIN_GROUP_ROUTES.remove(id), { method: 'DELETE', schema: noContentSchema }),

        addMembers: (id: string, input: AddGroupMembersInput): Promise<AddGroupMembersResult> =>
          request(ADMIN_GROUP_ROUTES.addMembers(id), {
            method: 'POST',
            body: input,
            schema: addGroupMembersResultSchema,
          }),

        removeMember: (id: string, studentId: string): Promise<NoContent> =>
          request(ADMIN_GROUP_ROUTES.removeMember(id, studentId), {
            method: 'DELETE',
            schema: noContentSchema,
          }),
      },

      /**
       * Subject -> Topic -> SubTopic. A sub-topic is SHARED: creating one links an
       * existing row where the name already exists rather than minting a second.
       */
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

        listSubTopics: (query: SubTopicListQueryInput = {}): Promise<Paginated<SubTopic>> =>
          requestPaginated(`${ADMIN_TAXONOMY_ROUTES.subTopics}${queryString({ ...query })}`, {
            schema: subTopicSchema.array(),
          }),

        createSubTopic: (input: CreateSubTopicInput): Promise<SubTopic> =>
          request(ADMIN_TAXONOMY_ROUTES.subTopics, {
            method: 'POST',
            body: input,
            schema: subTopicSchema,
          }),

        updateSubTopic: (id: string, input: UpdateSubTopicInput): Promise<SubTopic> =>
          request(ADMIN_TAXONOMY_ROUTES.subTopic(id), {
            method: 'PATCH',
            body: input,
            schema: subTopicSchema,
          }),
      },

      questions: {
        list: (query: QuestionListQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
          requestPaginated(`${ADMIN_QUESTION_ROUTES.list}${queryString({ ...query })}`, {
            schema: questionSummarySchema.array(),
          }),

        detail: (id: string): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.get(id), { schema: questionDetailSchema }),

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

        /** Retire or restore. An inactive question is drawn into no future paper. */
        setActive: (id: string, input: SetQuestionActiveInput): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.setActive(id), {
            method: 'PATCH',
            body: input,
            schema: questionDetailSchema,
          }),

        setStatus: (id: string, input: SetQuestionStatusInput): Promise<QuestionDetail> =>
          request(ADMIN_QUESTION_ROUTES.setStatus(id), {
            method: 'PATCH',
            body: input,
            schema: questionDetailSchema,
          }),
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

        /** Adding existing students to ONE group — the group is in the path. */
        groupMemberTemplate: (): Promise<Blob> => requestBlob(GROUP_IMPORT_ROUTES.membersTemplate),

        previewGroupMembers: (groupId: string, file: File): Promise<GroupMemberImportPlan> =>
          request(GROUP_IMPORT_ROUTES.membersPreview(groupId), {
            method: 'POST',
            body: fileBody(file),
            schema: groupMemberImportPlanSchema,
          }),

        commitGroupMembers: (groupId: string, file: File): Promise<GroupMemberImportResult> =>
          request(GROUP_IMPORT_ROUTES.membersCommit(groupId), {
            method: 'POST',
            body: fileBody(file),
            schema: groupMemberImportResultSchema,
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

        commitQuestions: (importLogId: string): Promise<QuestionImportResult> =>
          request(QUESTION_IMPORT_ROUTES.commit, {
            method: 'POST',
            body: { importLogId },
            schema: questionImportResultSchema,
          }),
      },

      audit: {
        rowActions: (query: RowActionListQueryInput = {}): Promise<Paginated<RowAction>> =>
          requestPaginated(`${ADMIN_AUDIT_ROUTES.rowActions}${queryString({ ...query })}`, {
            schema: rowActionSchema.array(),
          }),

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
