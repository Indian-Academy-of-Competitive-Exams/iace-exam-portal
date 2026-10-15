import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  printablePaperSchema,
  type PrintablePaper,
  type PrintablePaperQueryInput,
} from '../attempts';
import { testAnalyticsSchema, type TestAnalytics } from '../stats-test-analytics';
import {
  ADMIN_TEST_PAPER_ROUTES,
  ADMIN_TEST_ROUTES,
  testDetailSchema,
  testPaperSchema,
  testSchema,
  testSeriesLinkSchema,
  testOfferingSchema,
  type AddPaperQuestionInput,
  type CreateTestInput,
  type ReplacePaperQuestionInput,
  type SetPaperQuestionStatusInput,
  type SetTestSeriesInput,
  type SaveOfferingInput,
  type Test,
  type TestDetail,
  type TestListQueryInput,
  type TestPaper,
  type TestSeriesLink,
  type TestOffering,
  type UpdateTestInput,
} from '../tests';
import {
  questionImportPlanSchema,
  questionImportResultSchema,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '../question-import';
import { queryString, type ApiCore } from './core';
import { fileBody } from './admin-imports';

export function adminTestsClient(core: ApiCore) {
  const { get, write, list, requestBlob, requestExport } = core;

  return {
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

      reportExport: (id: string): Promise<Blob> =>
        requestExport(ADMIN_TEST_ROUTES.reportExport(id)),

      /** The paper as it stands, built a question or a section at a time. */
      readPaper: (id: string): Promise<TestPaper> =>
        get(ADMIN_TEST_PAPER_ROUTES.read(id), testPaperSchema),

      /** The whole paper in full, to print; its key travels only when asked for, and only to a super admin. */
      printablePaper: (id: string, query: PrintablePaperQueryInput = {}): Promise<PrintablePaper> =>
        get(
          `${ADMIN_TEST_PAPER_ROUTES.print(id)}${queryString({ ...query })}`,
          printablePaperSchema,
        ),

      /** Several at once, in the next free places its section has. */
      addPaperQuestions: (id: string, input: AddPaperQuestionInput): Promise<TestPaper> =>
        write('POST', ADMIN_TEST_PAPER_ROUTES.addQuestion(id), testPaperSchema, input),

      removePaperQuestions: (id: string, rowIds: readonly string[]): Promise<TestPaper> =>
        write(
          'DELETE',
          `${ADMIN_TEST_PAPER_ROUTES.removeQuestions(id)}${queryString({ rowIds: [...rowIds] })}`,
          testPaperSchema,
        ),

      /** One row swapped for another question, keeping its place on the paper. */
      replacePaperQuestion: (
        id: string,
        rowId: string,
        input: ReplacePaperQuestionInput,
      ): Promise<TestPaper> =>
        write('PATCH', ADMIN_TEST_PAPER_ROUTES.replaceQuestion(id, rowId), testPaperSchema, input),

      /** Fills the rest of one section from its own spec; every hand-picked row keeps its place. */
      fillPaperSection: (id: string, sectionId: string): Promise<TestPaper> =>
        write('POST', ADMIN_TEST_PAPER_ROUTES.fillSection(id, sectionId), testPaperSchema),

      /** A picked section, full, handed to its proof-reader. */
      handOverSection: (id: string, sectionId: string): Promise<TestPaper> =>
        write('POST', ADMIN_TEST_PAPER_ROUTES.handOver(id, sectionId), testPaperSchema),

      /** The test's own sheet: the bank's columns with a Section dropdown of this test's sections. */
      importTemplate: (id: string): Promise<Blob> =>
        requestBlob(ADMIN_TEST_PAPER_ROUTES.importTemplate(id)),

      /** One sheet for the whole typed test, each row into its section's typist's drafts. */
      previewImport: (id: string, file: File): Promise<QuestionImportPlan> =>
        write(
          'POST',
          ADMIN_TEST_PAPER_ROUTES.importPreview(id),
          questionImportPlanSchema,
          fileBody(file),
        ),

      commitImport: (id: string, importLogId: string): Promise<QuestionImportResult> =>
        write('POST', ADMIN_TEST_PAPER_ROUTES.importCommit(id), questionImportResultSchema, {
          importLogId,
        }),

      /** Drops a question or makes it a bonus, and re-scores every sitting that served it. */
      setPaperQuestionStatus: (
        id: string,
        rowId: string,
        input: SetPaperQuestionStatusInput,
      ): Promise<TestPaper> =>
        write('PATCH', ADMIN_TEST_PAPER_ROUTES.questionStatus(id, rowId), testPaperSchema, input),

      /** The Offer step's one write, in one transaction: a refusal leaves the test as it was. */
      saveOffering: (id: string, input: SaveOfferingInput): Promise<TestOffering> =>
        write('PUT', ADMIN_TEST_PAPER_ROUTES.offering(id), testOfferingSchema, input),

      moveToSeries: (id: string, input: SetTestSeriesInput): Promise<TestSeriesLink> =>
        write('POST', ADMIN_TEST_PAPER_ROUTES.series(id), testSeriesLinkSchema, input),
    },
  };
}
