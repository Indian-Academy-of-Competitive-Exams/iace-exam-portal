import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  ADMIN_AUTHORING_ROUTES,
  authoringDuplicateSchema,
  authoringSaveResultSchema,
  authoringStatsSchema,
  type AuthoringHistoryQueryInput,
  type AuthoringDuplicate,
  type AuthoringSaveResult,
  type AuthoringStats,
} from '../authoring';
import {
  ADMIN_QUESTION_ROUTES,
  type QuestionExportQueryInput,
  questionDetailSchema,
  questionAvailabilitySchema,
  questionSummarySchema,
  questionVersionSummarySchema,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionAvailability,
  type QuestionAvailabilityQueryInput,
  type QuestionListQueryInput,
  type QuestionSummary,
  type QuestionVersionSummary,
} from '../questions';
import {
  QUESTION_IMAGE_FILE_FIELD,
  questionImageSchema,
  type QuestionImage,
} from '../question-content';
import {
  ADMIN_TAXONOMY_ROUTES,
  subjectSchema,
  topicSchema,
  type CreateSubjectInput,
  type CreateTopicInput,
  type Subject,
  type SubjectListQueryInput,
  type Topic,
  type TopicListQueryInput,
  type UpdateSubjectBody,
  type UpdateTopicBody,
} from '../question-taxonomy';
import { queryString, type ApiCore } from './core';

export function adminQuestionsClient(core: ApiCore) {
  const { get, write, list, requestExport } = core;

  return {
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

      updateSubject: (id: string, input: UpdateSubjectBody): Promise<Subject> =>
        write('PATCH', ADMIN_TAXONOMY_ROUTES.subject(id), subjectSchema, input),

      removeSubject: (id: string): Promise<NoContent> =>
        write('DELETE', ADMIN_TAXONOMY_ROUTES.subject(id), noContentSchema),

      updateTopic: (id: string, input: UpdateTopicBody): Promise<Topic> =>
        write('PATCH', ADMIN_TAXONOMY_ROUTES.topic(id), topicSchema, input),

      removeTopic: (id: string): Promise<NoContent> =>
        write('DELETE', ADMIN_TAXONOMY_ROUTES.topic(id), noContentSchema),
    },

    /** A typist's own questions. Every route here is scoped to the caller by the server. */
    authoring: {
      stats: (): Promise<AuthoringStats> => get(ADMIN_AUTHORING_ROUTES.stats, authoringStatsSchema),

      history: (query: AuthoringHistoryQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
        list(ADMIN_AUTHORING_ROUTES.history, query, questionSummarySchema),

      detail: (id: string): Promise<QuestionDetail> =>
        get(ADMIN_AUTHORING_ROUTES.get(id), questionDetailSchema),

      create: (input: QuestionDraftInput): Promise<AuthoringSaveResult> =>
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
    },

    questions: {
      list: (query: QuestionListQueryInput = {}): Promise<Paginated<QuestionSummary>> =>
        list(ADMIN_QUESTION_ROUTES.list, query, questionSummarySchema),

      export: (query: QuestionExportQueryInput): Promise<Blob> =>
        requestExport(ADMIN_QUESTION_ROUTES.export, { ...query }),

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

      /** The soft remove: out of circulation and out of the bank, losing nothing. */
      archive: (id: string): Promise<QuestionDetail> =>
        write('POST', ADMIN_QUESTION_ROUTES.archive(id), questionDetailSchema),

      unarchive: (id: string): Promise<QuestionDetail> =>
        write('POST', ADMIN_QUESTION_ROUTES.unarchive(id), questionDetailSchema),

      /** Only a draft nothing has drawn. Everything else is archived, never removed. */
      remove: (id: string): Promise<NoContent> =>
        write('DELETE', ADMIN_QUESTION_ROUTES.remove(id), noContentSchema),

      /** Content stores the `key`; the `url` is for showing the image that was just chosen. */
      uploadImage: (file: File): Promise<QuestionImage> => {
        const form = new FormData();
        form.append(QUESTION_IMAGE_FILE_FIELD, file);
        return write('POST', ADMIN_QUESTION_ROUTES.uploadImage, questionImageSchema, form);
      },
    },
  };
}
