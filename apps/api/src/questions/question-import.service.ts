import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ImportSource, Prisma } from '@prisma/client';
import {
  AUDIT_FEATURE,
  AppException,
  AUDIT_ACTION,
  ErrorCodes,
  IMPORT_LOG_STATUS,
  IMPORT_TARGET_BANK,
  QUESTION_IMPORT_SHEETS,
  imageKeysIn,
  type QuestionDraft,
  type QuestionImportDraft,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '@iace/contracts';
import {
  importFileContentType,
  importFileKey,
  readUploadedTable,
  refuseFileErrors,
  rowsWithErrors,
  type CsvTable,
} from '../common/importing';
import { type ExportSheet } from '../common/exporting';
import { formRefusal } from '../common/form-refusal';
import { assertJobOpen } from '../assignments';
import { AuditService } from '../audit';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildContent, type BuiltQuestion } from './question-core';
import {
  NO_DEDUP,
  planQuestionImport,
  withoutDrafts,
  type ImportDedupContext,
  type ImportScope,
  type PlannedRow,
  type QuestionImportPlanning,
} from './question-import';
import { buildQuestionTemplate } from './question-workbook';
import { IMMUTABLE_CACHE_CONTROL, applyImageUrls, stripImageSrc } from './question-images';
import { rewriteDraftHtml } from './question-content';
import { loadTaxonomyCatalog } from './taxonomy-context';

const UPLOAD_GONE = 'That upload is no longer available';
const ALREADY_IMPORTED = 'That file has already been imported';
const PREVIEWED_ELSEWHERE = 'That file was previewed for somewhere else. Upload it again here.';

/** A file-level refusal opens no run, so the plan it hands back names none. */
const NO_RUN = '';

/** What the review window laid over the file: each corrected line's draft, and the lines left out. */
interface RowOverlay {
  drafts: ReadonlyMap<number, QuestionDraft>;
  leftOut: ReadonlySet<number>;
}

const PICTURES_NOT_CARRIED =
  'This row had pictures, which this download does not carry. Fix the row in your original sheet.';

/** A sheet of questions, in two steps that share one plan: the file is uploaded ONCE, the preview stores it and opens an import run, and the commit names that run and re-reads and re-plans the stored file rather than trusting a plan the client hands back or sending the same megabytes again — a client that can send a plan can send any plan, and the bank may have gained the same question in between. */
@Injectable()
export class QuestionImportService {
  private readonly logger = new Logger(QuestionImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Generated per request: it carries the taxonomy as it stands right now. */
  async template(): Promise<Buffer> {
    return buildQuestionTemplate(await loadTaxonomyCatalog(this.prisma));
  }

  async preview(
    file: Buffer,
    actorId: string,
    section?: ImportSection,
  ): Promise<QuestionImportPlan> {
    const planning = await this.plan(file, undefined, targetOf(section));
    // Judged before the run exists: a file nothing can be planned from would leave a total-0 row and a sheet in storage nothing ever fetches.
    if (planning.fileErrors.length > 0) return withoutDrafts(planning, NO_RUN);

    const log = await this.prisma.importLog.create({
      data: {
        feature: AUDIT_FEATURE.QUESTION,
        source: ImportSource.SHEET,
        actorId,
        target: targetOf(section),
        total: planning.summary.total,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: fileErrorsOf(planning),
      },
    });

    // Keyed by the run, so the sheet that produced a set of questions can always be fetched back — the answer to "where did this question come from".
    const key = importFileKey(AUDIT_FEATURE.QUESTION, log.id, file);
    await this.storage.upload(key, file, importFileContentType(key));
    await this.prisma.importLog.update({ where: { id: log.id }, data: { fileS3Key: key } });
    // Stored now, not at Import: the review window has to show them before anything is written.
    await this.storePictures(planning.rows);

    return withoutDrafts(planning, log.id);
  }

  /** The rows a preview would skip, as the file had them. Opens no run and stores nothing. */
  async errorRows(file: Buffer): Promise<ExportSheet> {
    const table = await readQuestionTable(file);
    const planning = await this.planTable(table);
    refuseFileErrors(planning.fileErrors);
    const pictured = new Set(table.rows.flatMap((row) => (row.pictures ? [row.line] : [])));
    return rowsWithErrors(
      table,
      new Map(
        planning.rows.map((row) => [
          row.line,
          [
            ...row.issues.map((issue) => issue.message),
            ...(row.issues.length > 0 && pictured.has(row.line) ? [PICTURES_NOT_CARRIED] : []),
          ],
        ]),
      ),
    );
  }

  async commit(importLogId: string, into: ImportTarget): Promise<QuestionImportResult> {
    const { log, file } = await this.openRun(importLogId, into.actorId);
    if (log.target !== null && log.target !== targetOf(into.section)) {
      throw formRefusal(ErrorCodes.CONFLICT, PREVIEWED_ELSEWHERE);
    }
    const planning = await this.plan(file, await this.overlayOf(log.id), log.target);
    const creatable = planning.rows.filter(
      (row): row is PlannedRow & { draft: NonNullable<PlannedRow['draft']> } =>
        row.action === 'create' && row.draft !== null,
    );

    const result: QuestionImportResult = {
      ...planning.summary,
      created: creatable.length,
      skipped: planning.summary.total - creatable.length,
    };

    let created: { id: string }[];
    try {
      await this.storePictures(creatable);

      // Interactive, not an array of promises: every question is three statements — the row, its first version, and the pointer between them — and all of them share one transaction.
      created = await this.prisma.$transaction(async (tx) => {
        if (into.section) await assertJobOpen(tx, into.section.assignmentId);
        // Claimed before any row is written: of two commits that both read the run open, the second waits here and finds it taken.
        const claimed = await tx.importLog.updateMany({
          where: { id: log.id, status: { not: IMPORT_LOG_STATUS.COMMITTED } },
          data: {
            total: planning.summary.total,
            created: result.created,
            // `failed` stays 0: a commit that returned reached every row, and a row it chose not to write is skipped.
            skipped: result.skipped,
            status: IMPORT_LOG_STATUS.COMMITTED,
            finishedAt: new Date(),
            errors: fileErrorsOf(planning),
          },
        });
        if (claimed.count !== 1) throw new AppException(ErrorCodes.CONFLICT, ALREADY_IMPORTED);

        const rows: { id: string }[] = [];
        for (const row of creatable) {
          const built = buildContent(row.draft);
          const question = await tx.question.create({
            data: {
              ...questionData(row.draft, built, log.actorId),
              assignmentId: into.section?.assignmentId,
            },
          });
          const version = await tx.questionVersion.create({
            data: versionData(question.id, built, log.actorId),
          });
          await tx.question.update({
            where: { id: question.id },
            data: { currentVersionId: version.id },
          });
          rows.push(question);
        }
        return rows;
      }, TX_LIMITS.BULK);
    } catch (error) {
      await this.closeFailedRun(log.id, creatable.length, error);
      throw error;
    }

    try {
      await this.audit.recordImportRows(
        log.id,
        AUDIT_FEATURE.QUESTION,
        created.map((question) => ({ entityId: question.id, action: AUDIT_ACTION.CREATE })),
        log.actorId,
      );
    } catch (error) {
      // The questions are already durable; losing their audit rows is a cost, never a reason to report an import that happened as one that did not.
      this.logger.error(`Row actions for import ${log.id} were not recorded`, error);
    }

    return result;
  }

  /** A commit that died closes its run the way the roster importer's does: FAILED, with the rows it never reached and why, rather than PREVIEWED for ever. A run another commit imported stays imported. */
  private async closeFailedRun(logId: string, failed: number, error: unknown): Promise<void> {
    await this.prisma.importLog.updateMany({
      where: { id: logId, status: { not: IMPORT_LOG_STATUS.COMMITTED } },
      data: {
        failed,
        status: IMPORT_LOG_STATUS.FAILED,
        finishedAt: new Date(),
        errors: { message: error instanceof Error ? error.message : String(error) },
      },
    });
  }

  /** Before the questions: a row must never show a picture that is not there yet. Keyed by content, so a retry rewrites the same objects. */
  private async storePictures(rows: readonly PlannedRow[]): Promise<void> {
    const pictures = new Map(rows.flatMap((row) => [...row.pictures]));
    for (const [key, image] of pictures) {
      await this.storage.upload(key, image.buffer, image.contentType, IMMUTABLE_CACHE_CONTROL);
    }
  }

  /** Every row's question as the review window opens it, pictures given urls it can draw. */
  async drafts(importLogId: string, actorId: string): Promise<QuestionImportDraft[]> {
    const { log, file } = await this.openRun(importLogId, actorId);
    const planning = await this.plan(file, await this.overlayOf(log.id), log.target);
    return planning.rows.map((row) => ({ line: row.line, draft: this.drawable(row.editable) }));
  }

  /** Holds one row's correction against the run, and answers with every row judged again. */
  async saveRow(
    importLogId: string,
    line: number,
    draft: QuestionDraft,
    actorId: string,
  ): Promise<QuestionImportPlan> {
    // The key is the record; a src is only how this window drew the picture.
    const stored = rewriteDraftHtml(draft, stripImageSrc) as unknown as Prisma.InputJsonValue;
    return this.changeRow(importLogId, line, actorId, { draft: stored });
  }

  /** Sets one previewed row aside from Import, or brings it back with any correction it carried. */
  async leaveOutRow(
    importLogId: string,
    line: number,
    leftOut: boolean,
    actorId: string,
  ): Promise<QuestionImportPlan> {
    return this.changeRow(importLogId, line, actorId, { leftOut });
  }

  /** One row's change from the review window, held against the run; answers with every row judged again. */
  private async changeRow(
    importLogId: string,
    line: number,
    actorId: string,
    change: { draft: Prisma.InputJsonValue } | { leftOut: boolean },
  ): Promise<QuestionImportPlan> {
    const { log, file } = await this.openRun(importLogId, actorId);
    const table = await readQuestionTable(file);
    if (!table.rows.some((row) => row.line === line)) {
      throw new AppException(ErrorCodes.NOT_FOUND, `Line ${line} is not in that file`);
    }

    await this.prisma.importRowEdit.upsert({
      where: { importLogId_line: { importLogId: log.id, line } },
      create: { importLogId: log.id, line, ...change },
      update: change,
    });

    const planning = await this.planTable(table, await this.overlayOf(log.id), log.target);
    return withoutDrafts(planning, log.id);
  }

  /** A previewed, uncommitted run, and only for the admin who previewed it — a super admin included. */
  private async openRun(importLogId: string, actorId: string) {
    const log = await this.prisma.importLog.findUnique({ where: { id: importLogId } });
    if (log?.feature !== AUDIT_FEATURE.QUESTION || !log.fileS3Key) {
      throw new AppException(ErrorCodes.NOT_FOUND, UPLOAD_GONE);
    }
    if (log.actorId !== actorId) {
      throw new AppException(ErrorCodes.NOT_FOUND, UPLOAD_GONE);
    }
    if (log.status === IMPORT_LOG_STATUS.COMMITTED) {
      throw new AppException(ErrorCodes.CONFLICT, ALREADY_IMPORTED);
    }
    return { log, file: await this.storage.read(log.fileS3Key) };
  }

  private async overlayOf(importLogId: string): Promise<RowOverlay> {
    const rows = await this.prisma.importRowEdit.findMany({ where: { importLogId } });
    return {
      drafts: new Map(
        rows.flatMap((row) =>
          row.draft === null ? [] : [[row.line, row.draft as unknown as QuestionDraft] as const],
        ),
      ),
      leftOut: new Set(rows.filter((row) => row.leftOut).map((row) => row.line)),
    };
  }

  private drawable(draft: QuestionDraft): QuestionDraft {
    const html = [
      ...Object.values(draft.stem),
      ...Object.values(draft.solution ?? {}),
      ...draft.options.flatMap((option) => Object.values(option.text)),
    ];
    const keys = new Set(html.flatMap((field) => imageKeysIn(field ?? '')));
    const urls = new Map([...keys].map((key) => [key, this.storage.publicUrl(key)]));
    return rewriteDraftHtml(draft, (html) => applyImageUrls(html, urls));
  }

  /** Read, resolve, judge — the one path a preview and a commit both take. */
  private async plan(
    file: Buffer,
    overlay?: RowOverlay,
    target?: string | null,
  ): Promise<QuestionImportPlanning> {
    return this.planTable(await readQuestionTable(file), overlay, target);
  }

  private async planTable(
    table: CsvTable,
    overlay?: RowOverlay,
    target?: string | null,
  ): Promise<QuestionImportPlanning> {
    const [catalog, scope] = await Promise.all([
      loadTaxonomyCatalog(this.prisma),
      this.scopeOf(target ?? null),
    ]);
    const { drafts, leftOut } = overlay ?? {};

    // Planned twice: the first pass only harvests the keys the bank is then asked about.
    const harvest = planQuestionImport(table, catalog, NO_DEDUP, drafts, leftOut);
    const dedup = await this.dedupContext(harvest.rows);
    return planQuestionImport(table, catalog, dedup, drafts, leftOut, scope);
  }

  /** What a section's own run is judged against; the bank's has no such bounds. */
  private async scopeOf(target: string | null): Promise<ImportScope | null> {
    if (target === null || target === IMPORT_TARGET_BANK) return null;
    const [, baseConfigSectionId = ''] = target.split('/');
    const section = await this.prisma.baseConfigSection.findUnique({
      where: { id: baseConfigSectionId },
      select: { name: true, subject: { select: { id: true, name: true } } },
    });
    return section && { sectionName: section.name, subject: section.subject };
  }

  /** Only the rows this sheet could clash with: the whole bank was read to answer a few hundred asks. */
  private async dedupContext(planned: readonly PlannedRow[]): Promise<ImportDedupContext> {
    const hashes = planned.flatMap((row) => (row.stemHash === null ? [] : [row.stemHash]));
    const codes = planned.flatMap((row) => (row.questionCode === null ? [] : [row.questionCode]));
    if (hashes.length === 0 && codes.length === 0) return NO_DEDUP;

    const rows = await this.prisma.question.findMany({
      where: { OR: [{ stemHash: { in: hashes } }, { questionCode: { in: codes } }] },
      select: { id: true, stemHash: true, questionCode: true },
    });

    const questionIdByHash = new Map<string, string>();
    const questionIdByCode = new Map<string, string>();
    for (const row of rows) {
      if (row.stemHash && !questionIdByHash.has(row.stemHash)) {
        questionIdByHash.set(row.stemHash, row.id);
      }
      if (row.questionCode) questionIdByCode.set(row.questionCode, row.id);
    }

    return { questionIdByHash, questionIdByCode };
  }
}

/** The question row — identity and taxonomy only. Where it came from is the ImportLog and its row actions, not a column here. */
function questionData(
  draft: NonNullable<PlannedRow['draft']>,
  built: BuiltQuestion,
  actorId: string | null,
): Prisma.QuestionUncheckedCreateInput {
  return {
    type: draft.type,
    subjectId: draft.subjectId,
    topicId: draft.topicId ?? null,
    difficulty: draft.difficulty,
    questionCode: draft.questionCode ?? null,
    tags: draft.tags,
    stemHash: built.stemHash,
    stemHashVersion: built.stemHashVersion,
    createdById: actorId,
  };
}

/** Version 1: everything an imported question actually says. */
function versionData(
  questionId: string,
  built: BuiltQuestion,
  actorId: string | null,
): Prisma.QuestionVersionUncheckedCreateInput {
  return {
    questionId,
    version: 1,
    createdById: actorId,
    content: built.content as Prisma.InputJsonValue,
    options: built.options.map((option) => ({
      id: randomUUID(),
      ...option,
    })) as unknown as Prisma.InputJsonValue,
    answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
}

function readQuestionTable(file: Buffer): Promise<CsvTable> {
  return readUploadedTable(file, { preferSheet: QUESTION_IMPORT_SHEETS.QUESTIONS });
}

/** What was wrong with the FILE, kept on the run so the history explains itself. */
function fileErrorsOf(planning: QuestionImportPlanning): Prisma.InputJsonValue | undefined {
  return planning.fileErrors.length > 0 ? { fileErrors: planning.fileErrors } : undefined;
}

export interface ImportSection {
  testId: string;
  baseConfigSectionId: string;
}

/** Where an imported sheet lands: the bank by default, or one section's own authoring. */
export interface ImportTarget {
  section?: ImportSection & { assignmentId: string };
  /** Whose upload it has to be: a run is committed by the admin who previewed it, nobody else. */
  actorId: string;
}

function targetOf(section: ImportSection | undefined): string {
  return section ? `${section.testId}/${section.baseConfigSectionId}` : IMPORT_TARGET_BANK;
}
