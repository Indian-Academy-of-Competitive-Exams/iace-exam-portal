import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
import {
  ActorTypes,
  EXPORT_KINDS,
  paginationQuerySchema,
  rowActionExportQuerySchema,
  rowActionListQuerySchema,
  type ExportStarted,
  type ImportLogSummary,
  type Paginated,
  type PaginationQuery,
  type RowAction,
  type RowActionExportQuery,
  type RowActionListQuery,
} from '@iace/contracts';
import { ExportJobsService } from '../common/exporting';
import {
  Actors,
  CurrentUser,
  RequiresExport,
  RequiresSuperAdmin,
  type AuthenticatedUser,
} from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AuditService, type AuditViewer } from './audit.service';

const viewerOf = (user: AuthenticatedUser): AuditViewer => ({
  id: user.id,
  isSuperAdmin: user.isSuperAdmin,
  isActive: user.isActive,
});

/** The log is a super admin's alone; the service still pins any other viewer to their own rows, for the callers that are not this one. */
@Controller('admin/audit')
@Actors(ActorTypes.ADMIN)
@RequiresSuperAdmin()
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly exportJobs: ExportJobsService,
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
  @Post('row-actions/export')
  @HttpCode(HttpStatus.ACCEPTED)
  exportRowActions(
    @Query(new ZodQuery(rowActionExportQuerySchema)) query: RowActionExportQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExportStarted> {
    return this.exportJobs.start({ kind: EXPORT_KINDS.AUDIT_LOG, query }, user);
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
  @Header('Cache-Control', 'no-store')
  async importFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.audit.importFile(id, viewerOf(user));

    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.body);
  }
}
