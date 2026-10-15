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
} from '../imports';
import {
  QUESTION_IMPORT_ROUTES,
  questionImportDraftsSchema,
  questionImportPlanSchema,
  questionImportResultSchema,
  type QuestionImportDraft,
  type QuestionImportLeaveOut,
  type QuestionImportRemap,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '../question-import';
import { type QuestionDraftInput } from '../questions';
import type { ApiCore } from './core';

/** One field, named once, so the server knows what to look for. */
export function fileBody(file: File): FormData {
  const form = new FormData();
  form.append(IMPORT_FILE_FIELD, file);
  return form;
}

export function adminImportsClient(core: ApiCore) {
  const { get, write, requestBlob, requestUploadBlob } = core;

  return {
    imports: {
      /** The sample workbook — a Blob, not an envelope. */
      studentTemplate: (): Promise<Blob> => requestBlob(IMPORT_ROUTES.studentsTemplate),

      /** Writes nothing — this is what the admin reads before committing. */
      previewStudents: (file: File): Promise<StudentImportPlan> =>
        write('POST', IMPORT_ROUTES.studentsPreview, studentImportPlanSchema, fileBody(file)),

      commitStudents: (file: File): Promise<StudentImportResult> =>
        write('POST', IMPORT_ROUTES.studentsCommit, studentImportResultSchema, fileBody(file)),

      /** The rows a preview skipped, with an Errors column — a Blob, not an envelope. */
      studentErrors: (file: File): Promise<Blob> =>
        requestUploadBlob(IMPORT_ROUTES.studentsErrors, fileBody(file)),

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

      eventCandidateErrors: (eventId: string, file: File): Promise<Blob> =>
        requestUploadBlob(IMPORT_ROUTES.eventCandidatesErrors(eventId), fileBody(file)),

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

      programStudentErrors: (code: string, file: File): Promise<Blob> =>
        requestUploadBlob(IMPORT_ROUTES.programStudentsErrors(code), fileBody(file)),

      /** The question workbook: Questions, Instructions, and the live taxonomy on Lists. */
      questionTemplate: (): Promise<Blob> => requestBlob(QUESTION_IMPORT_ROUTES.template),

      /** Uploads once — the file is kept and an import run opened, so committing names the run rather than sending the same megabytes twice. */
      previewQuestions: (file: File): Promise<QuestionImportPlan> =>
        write('POST', QUESTION_IMPORT_ROUTES.preview, questionImportPlanSchema, fileBody(file)),

      questionErrors: (file: File): Promise<Blob> =>
        requestUploadBlob(QUESTION_IMPORT_ROUTES.errors, fileBody(file)),

      commitQuestions: (importLogId: string): Promise<QuestionImportResult> =>
        write('POST', QUESTION_IMPORT_ROUTES.commit, questionImportResultSchema, {
          importLogId,
        }),

      /** Every previewed row's question, corrections laid over the sheet, for the review window. */
      questionDrafts: (importLogId: string): Promise<QuestionImportDraft[]> =>
        get(QUESTION_IMPORT_ROUTES.drafts(importLogId), questionImportDraftsSchema),

      /** Saves one row's correction against the run and answers with every row judged again. */
      saveQuestionRow: (
        importLogId: string,
        line: number,
        draft: QuestionDraftInput,
      ): Promise<QuestionImportPlan> =>
        write(
          'PUT',
          QUESTION_IMPORT_ROUTES.row(importLogId, line),
          questionImportPlanSchema,
          draft,
        ),

      /** Sets one row aside from Import, or brings it back, and answers with every row judged again. */
      leaveOutQuestionRow: (
        importLogId: string,
        line: number,
        body: QuestionImportLeaveOut,
      ): Promise<QuestionImportPlan> =>
        write(
          'PUT',
          QUESTION_IMPORT_ROUTES.leaveOut(importLogId, line),
          questionImportPlanSchema,
          body,
        ),

      remapQuestionRun: (
        importLogId: string,
        body: QuestionImportRemap,
      ): Promise<QuestionImportPlan> =>
        write('POST', QUESTION_IMPORT_ROUTES.remap(importLogId), questionImportPlanSchema, body),

      rejudgeQuestionRun: (importLogId: string): Promise<QuestionImportPlan> =>
        write('POST', QUESTION_IMPORT_ROUTES.rejudge(importLogId), questionImportPlanSchema),
    },
  };
}
