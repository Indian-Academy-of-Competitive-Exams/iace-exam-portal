import { Injectable } from '@nestjs/common';
import { AuditFeature, ImportSource, Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMPORT_SHEETS,
  QUESTION_SOURCE_KIND,
  XLSX_CONTENT_TYPE,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '@iace/contracts';
import { IMPORT_LOG_STATUS, importFileKey, readUploadedTable } from '../common/importing';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildContent } from './question-core';
import {
  planQuestionImport,
  withoutDrafts,
  type ImportDedupContext,
  type PlannedRow,
  type QuestionImportPlanning,
} from './question-import';
import { buildQuestionTemplate } from './question-workbook';
import { loadTaxonomyCatalog } from './taxonomy-context';

/**
 * A sheet of questions, in two steps that share one plan.
 *
 * The file is uploaded ONCE: the preview stores it and opens an import run, and
 * the commit names that run rather than sending the same megabytes again. The
 * commit then re-reads the stored file and re-plans it — it never trusts a plan
 * the client hands back, because a client that can send a plan can send any plan,
 * and because the bank may have gained the same question in between.
 *
 * TODO: synchronous today. Move the commit onto BullMQ if files outgrow one request.
 */
@Injectable()
export class QuestionImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Generated per request: it carries the taxonomy as it stands right now. */
  async template(): Promise<Buffer> {
    return buildQuestionTemplate(await loadTaxonomyCatalog(this.prisma));
  }

  async preview(file: Buffer, actorId: string): Promise<QuestionImportPlan> {
    const planning = await this.plan(file);

    const log = await this.prisma.importLog.create({
      data: {
        feature: AuditFeature.QUESTION,
        source: ImportSource.SHEET,
        actorId,
        total: planning.summary.total,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: fileErrorsOf(planning),
      },
    });

    // Keyed by the run, so the sheet that produced a set of questions can always
    // be fetched back — the answer to "where did this question come from".
    const key = importFileKey(AuditFeature.QUESTION, log.id);
    await this.storage.upload(key, file, XLSX_CONTENT_TYPE);
    await this.prisma.importLog.update({ where: { id: log.id }, data: { fileS3Key: key } });

    return withoutDrafts(planning, log.id);
  }

  async commit(importLogId: string): Promise<QuestionImportResult> {
    const log = await this.prisma.importLog.findUnique({ where: { id: importLogId } });
    if (!log || log.feature !== AuditFeature.QUESTION || !log.fileS3Key) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That upload is no longer available');
    }
    if (log.status === IMPORT_LOG_STATUS.COMMITTED) {
      throw new AppException(ErrorCodes.CONFLICT, 'That file has already been imported');
    }

    const planning = await this.plan(await this.storage.read(log.fileS3Key));
    const creatable = planning.rows.filter(
      (row): row is PlannedRow & { draft: NonNullable<PlannedRow['draft']> } =>
        row.action === 'create' && row.draft !== null,
    );

    await this.prisma.$transaction(
      creatable.map((row) =>
        this.prisma.question.create({ data: rowData(row, log.id, log.actorId) }),
      ),
    );

    const result: QuestionImportResult = {
      ...planning.summary,
      created: creatable.length,
      skipped: planning.summary.total - creatable.length,
    };

    await this.prisma.importLog.update({
      where: { id: log.id },
      data: {
        total: planning.summary.total,
        created: result.created,
        skipped: planning.summary.duplicates,
        failed: planning.summary.invalid,
        status: IMPORT_LOG_STATUS.COMMITTED,
        finishedAt: new Date(),
        errors: fileErrorsOf(planning),
      },
    });

    return result;
  }

  /** Read, resolve, judge — the one path a preview and a commit both take. */
  private async plan(file: Buffer): Promise<QuestionImportPlanning> {
    const table = await readUploadedTable(file, {
      preferSheet: QUESTION_IMPORT_SHEETS.QUESTIONS,
    });
    const catalog = await loadTaxonomyCatalog(this.prisma);

    return planQuestionImport(table, catalog, await this.dedupContext());
  }

  /**
   * What the bank already holds, in two reads rather than two per row. Only the
   * hash and the code are needed, so even a large bank is a small payload.
   */
  private async dedupContext(): Promise<ImportDedupContext> {
    const rows = await this.prisma.question.findMany({
      where: { stemHash: { not: null } },
      select: { id: true, stemHash: true, questionCode: true },
    });

    const questionIdByHash = new Map<string, string>();
    const takenCodes = new Set<string>();
    for (const row of rows) {
      if (row.stemHash && !questionIdByHash.has(row.stemHash)) {
        questionIdByHash.set(row.stemHash, row.id);
      }
      if (row.questionCode) takenCodes.add(row.questionCode);
    }

    return { questionIdByHash, takenCodes };
  }
}

function rowData(
  row: PlannedRow & { draft: NonNullable<PlannedRow['draft']> },
  importLogId: string,
  actorId: string | null,
): Prisma.QuestionCreateInput {
  const draft = row.draft;
  const built = buildContent(draft);

  return {
    type: draft.type,
    subject: { connect: { id: draft.subjectId } },
    ...(draft.topicId ? { topic: { connect: { id: draft.topicId } } } : {}),
    ...(draft.subTopicId ? { subTopic: { connect: { id: draft.subTopicId } } } : {}),
    difficulty: draft.difficulty,
    status: draft.status,
    isActive: true,
    questionCode: draft.questionCode ?? null,
    content: built.content as Prisma.InputJsonValue,
    answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    tags: draft.tags,
    defaultMarks: draft.defaultMarks ?? null,
    defaultNegativeMarks: draft.defaultNegativeMarks ?? null,
    stemHash: built.stemHash,
    createdById: actorId,
    source: {
      kind: QUESTION_SOURCE_KIND.IMPORT,
      importLogId,
      line: row.line,
    },
    options: { create: built.options },
  };
}

/** What was wrong with the FILE, kept on the run so the history explains itself. */
function fileErrorsOf(planning: QuestionImportPlanning): Prisma.InputJsonValue | undefined {
  return planning.fileErrors.length > 0 ? { fileErrors: planning.fileErrors } : undefined;
}
