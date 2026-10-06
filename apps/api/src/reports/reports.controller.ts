import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  reportKeySchema,
  reportQuerySchema,
  type ReportDocument,
  type ReportKey,
  type ReportQuery,
} from '@iace/contracts';
import { Audit, AuditContext } from '../audit';
import { chosenFilters, sendWorkbook } from '../common/exporting';
import {
  Actors,
  CurrentUser,
  RequiresExport,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { ReportsService } from './reports.service';

/** One route for every report: the key picks the builder, and the catalogue says what it needs. */
@Controller('admin/reports')
@Actors(ActorTypes.ADMIN)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly auditContext: AuditContext,
  ) {}

  @RequiresFeature(FEATURE_KEYS.REPORTS, PERMISSION_LEVELS.READ)
  @Get(':key')
  read(
    @Param('key', new ZodParam(reportKeySchema)) key: ReportKey,
    @Query(new ZodQuery(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportDocument> {
    return this.reports.document(key, query, user);
  }

  @RequiresExport(FEATURE_KEYS.REPORTS)
  @Audit(AUDIT_FEATURE.REPORT, AUDIT_ACTION.EXPORT)
  @Get(':key/export')
  async export(
    @Param('key', new ZodParam(reportKeySchema)) key: ReportKey,
    @Query(new ZodQuery(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { workbook, rows } = await this.reports.workbook(key, query, user);
    this.auditContext.setEntityId(user.id);
    this.auditContext.setChanged({
      report: { from: null, to: key },
      filters: { from: null, to: chosenFilters(query) },
      rows: { from: null, to: rows },
    });
    sendWorkbook(response, key, workbook);
  }
}
