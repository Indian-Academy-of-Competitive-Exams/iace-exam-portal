import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  EXPORT_KINDS,
  XLSX_CONTENT_TYPE,
  paginationQuerySchema,
  rowActionExportQuerySchema,
  rowActionListQuerySchema,
  type ImportLogSummary,
  type Paginated,
  type PaginationQuery,
  type RowAction,
  type RowActionExportQuery,
  type RowActionListQuery,
} from '@iace/contracts';
import { chosenFilters, sendWorkbook } from '../common/exporting';
import { Actors, CurrentUser, RequiresExport, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AuditContext } from './audit.context';
import { Audit } from './audit.decorator';
import { AuditService, type AuditViewer } from './audit.service';

const viewerOf = (user: AuthenticatedUser): AuditViewer => ({
  id: user.id,
  isSuperAdmin: user.isSuperAdmin,
  isActive: user.isActive,
});

/** No class-level `@RequiresFeature`: every admin reaches the reads, and the service is what decides whether a given row is theirs to see. */
@Controller('admin/audit')
@Actors(ActorTypes.ADMIN)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly auditContext: AuditContext,
  ) {}

  @Get('row-actions')
  rowActions(
    @Query(new ZodQuery(rowActionListQuerySchema)) query: RowActionListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<RowAction>> {
    return this.audit.listRowActions(query, viewerOf(user));
  }

  /** No feature owns the log, so DATA_EXPORT alone; the service scopes the rows as the list does. */
  @RequiresExport()
  @Audit(AUDIT_FEATURE.AUDIT_LOG, AUDIT_ACTION.EXPORT)
  @Get('row-actions/export')
  async exportRowActions(
    @Query(new ZodQuery(rowActionExportQuerySchema)) query: RowActionExportQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { workbook, rows } = await this.audit.exportRowActions(query, viewerOf(user));
    this.auditContext.setEntityId(user.id);
    this.auditContext.setChanged({
      filters: { from: null, to: chosenFilters(query) },
      rows: { from: null, to: rows },
    });
    sendWorkbook(response, EXPORT_KINDS.AUDIT_LOG, workbook);
  }

  @Get('imports')
  imports(
    @Query(new ZodQuery(paginationQuerySchema)) query: PaginationQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<ImportLogSummary>> {
    return this.audit.listImports(query, viewerOf(user));
  }

  /** The sheet the run was fed. Streamed, never a signed link: the file is full of student PII. */
  @Get('imports/:id/file')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Cache-Control', 'no-store')
  async importFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.audit.importFile(id, viewerOf(user));

    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.body);
  }
}
