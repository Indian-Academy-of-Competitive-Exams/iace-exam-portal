import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  questionDetailSchema,
  questionImportPlanSchema,
  questionImportResultSchema,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '../questions';
import {
  ADMIN_ASSIGNMENTS_ROUTES,
  assignableAdminSchema,
  assignmentSchema,
  assignmentSectionSchema,
  assignmentTestSchema,
  assignmentWithTestSchema,
  questionOnOtherTestSchema,
  sectionCommentSchema,
  sectionProgressRowSchema,
  type Assignment,
  type AssignableAdmin,
  type AssignableQueryInput,
  type AssignmentSection,
  type AssignmentSectionsQueryInput,
  type AssignmentTest,
  type AssignmentTestsQueryInput,
  type AssignmentWithTest,
  type ChangeAssignmentDueInput,
  type CreateAssignmentInput,
  type CreateSectionCommentInput,
  type EditSectionCommentInput,
  type MineAssignmentsQueryInput,
  type QuestionOnOtherTest,
  type SectionComment,
  type SectionProgressQueryInput,
  type SectionProgressRow,
  type TypistDoneInput,
} from '../assignments';
import {
  ADMIN_SECTION_WORK_ROUTES,
  sectionWorkSchema,
  type SectionWork,
  type SendBackInput,
  type WorkTimeInput,
  type WorkTimeTotal,
  workTimeTotalSchema,
} from '../section-work';
import { queryString, type ApiCore } from './core';
import { fileBody } from './admin-imports';

export function adminSectionsClient(core: ApiCore) {
  const { get, write, list } = core;

  return {
    /** One section of one test, as its typist, proof-reader or test owner works on it. */
    sectionWork: {
      one: (testId: string, sectionId: string): Promise<SectionWork> =>
        get(ADMIN_SECTION_WORK_ROUTES.one(testId, sectionId), sectionWorkSchema),

      question: (testId: string, sectionId: string, questionId: string): Promise<QuestionDetail> =>
        get(
          ADMIN_SECTION_WORK_ROUTES.question(testId, sectionId, questionId),
          questionDetailSchema,
        ),

      edit: (
        testId: string,
        sectionId: string,
        questionId: string,
        input: QuestionDraftInput,
      ): Promise<QuestionDetail> =>
        write(
          'PATCH',
          ADMIN_SECTION_WORK_ROUTES.question(testId, sectionId, questionId),
          questionDetailSchema,
          input,
        ),

      remove: (testId: string, sectionId: string, questionId: string): Promise<NoContent> =>
        write(
          'DELETE',
          ADMIN_SECTION_WORK_ROUTES.question(testId, sectionId, questionId),
          noContentSchema,
        ),

      /** The cross-test warning, read before the edit rather than reported after it. */
      otherTests: (
        testId: string,
        sectionId: string,
        questionId: string,
      ): Promise<QuestionOnOtherTest[]> =>
        get(
          ADMIN_SECTION_WORK_ROUTES.otherTests(testId, sectionId, questionId),
          questionOnOtherTestSchema.array(),
        ),

      check: (testId: string, sectionId: string, questionId: string): Promise<SectionWork> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.check(testId, sectionId, questionId),
          sectionWorkSchema,
        ),

      uncheck: (testId: string, sectionId: string, questionId: string): Promise<SectionWork> =>
        write(
          'DELETE',
          ADMIN_SECTION_WORK_ROUTES.check(testId, sectionId, questionId),
          sectionWorkSchema,
        ),

      sendBack: (
        testId: string,
        sectionId: string,
        questionId: string,
        input: SendBackInput,
      ): Promise<SectionWork> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.sendBack(testId, sectionId, questionId),
          sectionWorkSchema,
          input,
        ),

      /** Seconds this question has just been on screen, added to the caller's own total. */
      spend: (
        testId: string,
        sectionId: string,
        questionId: string,
        input: WorkTimeInput,
        extra: { keepalive?: boolean } = {},
      ): Promise<WorkTimeTotal> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.time(testId, sectionId, questionId),
          workTimeTotalSchema,
          input,
          extra,
        ),

      fixed: (testId: string, sectionId: string, questionId: string): Promise<SectionWork> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.fixed(testId, sectionId, questionId),
          sectionWorkSchema,
        ),

      /** A question typed for the section, landing under its typist's row. */
      create: (
        testId: string,
        sectionId: string,
        input: QuestionDraftInput,
      ): Promise<QuestionDetail> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.questions(testId, sectionId),
          questionDetailSchema,
          input,
        ),

      /** A sheet of questions straight into the section, rather than loose in the bank. */
      previewImport: (testId: string, sectionId: string, file: File): Promise<QuestionImportPlan> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.importPreview(testId, sectionId),
          questionImportPlanSchema,
          fileBody(file),
        ),

      commitImport: (
        testId: string,
        sectionId: string,
        importLogId: string,
      ): Promise<QuestionImportResult> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.importCommit(testId, sectionId),
          questionImportResultSchema,
          { importLogId },
        ),

      done: (testId: string, sectionId: string, input: TypistDoneInput): Promise<SectionWork> =>
        write('POST', ADMIN_SECTION_WORK_ROUTES.done(testId, sectionId), sectionWorkSchema, input),

      release: (testId: string, sectionId: string): Promise<SectionWork> =>
        write('POST', ADMIN_SECTION_WORK_ROUTES.release(testId, sectionId), sectionWorkSchema),

      /** The section thread, oldest first — a discussion is read in the order it was said. */
      comments: (testId: string, sectionId: string): Promise<SectionComment[]> =>
        get(ADMIN_SECTION_WORK_ROUTES.comments(testId, sectionId), sectionCommentSchema.array()),

      comment: (
        testId: string,
        sectionId: string,
        input: CreateSectionCommentInput,
      ): Promise<SectionComment> =>
        write(
          'POST',
          ADMIN_SECTION_WORK_ROUTES.comments(testId, sectionId),
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
          ADMIN_SECTION_WORK_ROUTES.comment(testId, sectionId, commentId),
          sectionCommentSchema,
          input,
        ),
    },

    /** Who types a section and who reads it, and the queue each of them works from. */
    assignments: {
      forTest: (testId: string): Promise<Assignment[]> =>
        get(ADMIN_ASSIGNMENTS_ROUTES.forTest(testId), assignmentSchema.array()),

      assign: (testId: string, input: CreateAssignmentInput): Promise<Assignment> =>
        write('POST', ADMIN_ASSIGNMENTS_ROUTES.assign(testId), assignmentSchema, input),

      remove: (testId: string, id: string): Promise<NoContent> =>
        write('DELETE', ADMIN_ASSIGNMENTS_ROUTES.remove(testId, id), noContentSchema),

      /** Moves the day on the seat as it is held; nobody new takes the role. */
      changeDueDate: (
        testId: string,
        id: string,
        input: ChangeAssignmentDueInput,
      ): Promise<Assignment> =>
        write('PATCH', ADMIN_ASSIGNMENTS_ROUTES.changeDue(testId, id), assignmentSchema, input),

      mine: (query: MineAssignmentsQueryInput = {}): Promise<Paginated<AssignmentWithTest>> =>
        list(ADMIN_ASSIGNMENTS_ROUTES.mine, query, assignmentWithTestSchema),

      /** How every section is going, for a super admin. Read only — nothing here acts. */
      progress: (query: SectionProgressQueryInput = {}): Promise<Paginated<SectionProgressRow>> =>
        list(ADMIN_ASSIGNMENTS_ROUTES.progress, query, sectionProgressRowSchema),

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
    },
  };
}
