import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  ADMIN_GRANT_ROUTES,
  ADMIN_STUDENT_SERIES_ROUTES,
  ADMIN_PROGRAM_ROUTES,
  ADMIN_SERIES_ROUTES,
  EVENT_ROUTES,
  seriesBranchSchema,
  eventSchema,
  programCatalogSchema,
  studentSeriesAccessSchema,
  testSeriesDetailSchema,
  testSeriesSummarySchema,
  type SeriesBranch,
  type AddEventCandidatesInput,
  type CreateEventInput,
  type CreateProgramInput,
  type CreateTestSeriesInput,
  type Event,
  type EventListQueryInput,
  type GrantSeriesInput,
  type Program,
  type ProgramListQueryInput,
  type StudentSeriesAccess,
  type TestSeriesListQueryInput,
  type TestSeriesDetail,
  type TestSeriesSummary,
  type ToggleSeriesBranchInput,
  type UpdateSeriesBranchesInput,
  type UpdateEventInput,
  type UpdateProgramInput,
  type UpdateTestSeriesInput,
} from '../access';
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
} from '../configs';
import { seriesTestRowSchema, type SeriesTestRow } from '../tests';
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
} from '../exams';
import type { ApiCore } from './core';

export function adminCatalogClient(core: ApiCore) {
  const { get, write, list, requestExport } = core;

  return {
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

      addCandidates: (id: string, input: AddEventCandidatesInput): Promise<NoContent> =>
        write('POST', EVENT_ROUTES.addCandidates(id), noContentSchema, input),

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

      toggleBranch: (id: string, input: ToggleSeriesBranchInput): Promise<SeriesBranch[]> =>
        write('PATCH', ADMIN_SERIES_ROUTES.branches(id), seriesBranchSchema.array(), input),

      tests: (id: string): Promise<SeriesTestRow[]> =>
        get(ADMIN_SERIES_ROUTES.tests(id), seriesTestRowSchema.array()),

      grantsExport: (id: string): Promise<Blob> =>
        requestExport(ADMIN_SERIES_ROUTES.grantsExport(id)),
    },

    /** Every series a student reaches and what opens each one, the branch gate already applied. */
    studentSeries: {
      list: (studentId: string): Promise<StudentSeriesAccess[]> =>
        get(ADMIN_STUDENT_SERIES_ROUTES.list(studentId), studentSeriesAccessSchema.array()),
    },

    /** The escape hatch, filed against the student it was made about. */
    grants: {
      create: (studentId: string, input: GrantSeriesInput): Promise<NoContent> =>
        write('POST', ADMIN_GRANT_ROUTES.create(studentId), noContentSchema, input),

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
  };
}
