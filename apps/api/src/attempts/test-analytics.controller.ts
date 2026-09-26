/**
 * A test's cohort report. It lives here rather than in the tests module because everything it
 * reads is an attempt rollup, and it pays with TEST_MANAGEMENT READ — the same key that opens the
 * test itself, so an admin who may see the paper may see how the paper went.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  EXPORT_KINDS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type TestAnalytics,
} from '@iace/contracts';
import { AccessResolverService } from '../access';
import { Audit, AuditContext } from '../audit';
import { sendWorkbook } from '../common/exporting';
import { Actors, RequiresExport, RequiresFeature } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { buildTestReport } from './test-report';
import { TestAnalyticsService } from './test-analytics.service';

@Controller('admin/tests')
@Actors(ActorTypes.ADMIN)
export class AdminTestAnalyticsController {
  constructor(
    private readonly analytics: TestAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly auditContext: AuditContext,
  ) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/analytics')
  forTest(@Param('id') testId: string): Promise<TestAnalytics> {
    return this.analytics.forTest(testId);
  }

  /** Changing the figures is managing the test, so asking for them again pays WRITE. */
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/analytics/resync')
  @HttpCode(HttpStatus.ACCEPTED)
  resync(@Param('id') testId: string): Promise<void> {
    return this.analytics.resync(testId);
  }

  @RequiresExport(FEATURE_KEYS.TEST_MANAGEMENT)
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.EXPORT)
  @Get(':id/report/export')
  async reportExport(@Param('id') testId: string, @Res() response: Response): Promise<void> {
    const { workbook, rows } = await buildTestReport(
      { prisma: this.prisma, analytics: this.analytics, access: this.access },
      testId,
    );
    this.auditContext.setEntityId(testId);
    this.auditContext.setChanged({ rows: { from: null, to: rows } });
    sendWorkbook(response, EXPORT_KINDS.TEST_REPORT, workbook);
  }
}
