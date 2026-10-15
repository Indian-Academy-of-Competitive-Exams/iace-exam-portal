import { z } from 'zod';
import { csvIdQuery, searchQuery } from './common';
import { blankIsAbsent } from './students';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';
import { languageCodeSchema } from './exams';

// ============================================================================
// Taxonomy: Subject -> Topic. Names are canonical, like branches, so
// "Percentages" and "PERCENTAGES " cannot both exist — a second row would split
// the per-topic analytics the taxonomy exists to join up. Anything finer than a
// topic is a `topic:` tag on the question.
// ============================================================================

const SUBJECT_NAME_MAX = 80;
const TOPIC_NAME_MAX = 100;

const subjectNameSchema = canonicalNameSchema({ max: SUBJECT_NAME_MAX, label: 'subject' });
export const topicNameSchema = canonicalNameSchema({ max: TOPIC_NAME_MAX, label: 'topic' });

/** A short code an institute already uses for a subject — QA, GA, ENG. */
const subjectCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .max(16)
      .regex(/^[A-Z0-9]+$/, 'Use capital letters and numbers only'),
  );

/** Enough to name any taxonomy row where the screen already knows what it is. */
export const taxonomyRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const subjectRefSchema = taxonomyRefSchema;

export const subjectSchema = subjectRefSchema.extend({
  code: z.string().nullable(),
  /** Set when the subject IS a language (Hindi Comprehension): its questions are written in it alone. */
  language: languageCodeSchema.nullable(),
  topicCount: z.number().int(),
  questionCount: z.number().int(),
});
export type Subject = z.infer<typeof subjectSchema>;

const topicRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: subjectRefSchema,
});

export const topicSchema = topicRefSchema.extend({
  questionCount: z.number().int(),
});
export type Topic = z.infer<typeof topicSchema>;

export const createSubjectSchema = z.object({
  name: subjectNameSchema,
  code: blankIsAbsent(subjectCodeSchema),
  /** Chosen once, at creation: its questions are written to it, so it never changes after. */
  language: languageCodeSchema.nullish(),
});
export type CreateSubjectInput = z.input<typeof createSubjectSchema>;
export type CreateSubjectBody = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z.object({
  name: subjectNameSchema.optional(),
  code: subjectCodeSchema.nullable().optional(),
});
export type UpdateSubjectBody = z.infer<typeof updateSubjectSchema>;

export const createTopicSchema = z.object({
  subjectId: z.string().min(1, 'Choose a subject'),
  name: topicNameSchema,
});
export type CreateTopicInput = z.input<typeof createTopicSchema>;
export type CreateTopicBody = z.infer<typeof createTopicSchema>;

/** A topic never moves subject — the questions under it would change meaning. */
export const updateTopicSchema = z.object({
  name: topicNameSchema,
});
export type UpdateTopicBody = z.infer<typeof updateTopicSchema>;

export const subjectListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  /** Only these rows: how a picker names a chosen value it has not loaded a page of. */
  id: csvIdQuery(),
});
export type SubjectListQuery = z.infer<typeof subjectListQuerySchema>;
export type SubjectListQueryInput = z.input<typeof subjectListQuerySchema>;

export const topicListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  /** Only these rows: how a picker names a chosen value it has not loaded a page of. */
  id: csvIdQuery(),
  /** Several, because the questions screen narrows topics by every subject it is filtering on. */
  subjectId: csvIdQuery(),
});
export type TopicListQuery = z.infer<typeof topicListQuerySchema>;
export type TopicListQueryInput = z.input<typeof topicListQuerySchema>;

export const ADMIN_TAXONOMY_ROUTES = {
  subjects: '/admin/subjects',
  topics: '/admin/topics',
  subject: (id: string) => `/admin/subjects/${id}`,
  topic: (id: string) => `/admin/topics/${id}`,
} as const;
