import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  forwardRef,
} from '@nestjs/common';
import { type Response } from 'express';
import {
  AUDIT_FEATURE,
  AUDIT_ACTION,
  AppException,
  ErrorCodes,
  EXPORT_KINDS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  STUDENT_EXPORT_VIEWS,
  ActorTypes,
  satisfiesLevel,
  createStudentSchema,
  setStudentActiveSchema,
  setStudentTestBlockedSchema,
  studentExportQuerySchema,
  studentListQuerySchema,
  studentSittingsQuerySchema,
  updateStudentSchema,
  type CreateStudentBody,
  type ErasureReceipt,
  type Paginated,
  type ReportSitting,
  type SetStudentActiveBody,
  type SetStudentTestBlockedBody,
  type StudentDetail,
  type StudentExportQuery,
  type StudentListQuery,
  type StudentSittingsQuery,
  type StudentSummary,
  type UpdateStudentBody,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  RequiresExport,
  RequiresFeature,
  RequiresSuperAdmin,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit, AuditContext, TOGGLE_ACTIONS } from '../audit';
import { sendWorkbook } from '../common/exporting';
import { PrismaService } from '../prisma/prisma.service';
import { type StudentOverviewService } from '../attempts';
import { StudentsService } from './students.service';
import { StudentPrivacyService } from './student-privacy.service';
import { buildStudentExport } from './student-export';

/** The admin-side student directory. `@Actors(ADMIN)` is the hard boundary — a student's token is a valid JWT and must not reach here. `@RequiresFeature` is per route: read vs write. */
@Controller('admin/students')
@Actors(ActorTypes.ADMIN)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly privacy: StudentPrivacyService,
    private readonly prisma: PrismaService,
    // `require`, not a static import: `attempts` reaches `configs`, which imports this barrel back.
    @Inject(
      forwardRef(
        () =>
          (
            module.require('../attempts') as {
              StudentOverviewService: typeof StudentOverviewService;
            }
          ).StudentOverviewService,
      ),
    )
    private readonly rollups: StudentOverviewService,
    private readonly auditContext: AuditContext,
  ) {}

  /** Returns the list shape the response interceptor splits into data + meta. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(studentListQuerySchema)) query: StudentListQuery,
  ): Promise<Paginated<StudentSummary>> {
    return this.students.list(query);
  }

  /** Declared before `:id`, which would otherwise take "export" as a student id. */
  @RequiresExport(FEATURE_KEYS.STUDENT_MANAGEMENT)
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.EXPORT)
  @Get('export')
  async export(
    @Query(new ZodQuery(studentExportQuerySchema)) query: StudentExportQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const performance = query.view === STUDENT_EXPORT_VIEWS.PERFORMANCE;
    if (performance && !user.isSuperAdmin && !canReadPerformance(user)) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'You do not have access to student performance');
    }
    const { workbook, rows } = await buildStudentExport(
      { prisma: this.prisma, rollups: this.rollups },
      query,
    );
    this.auditContext.setEntityId(user.id);
    this.auditContext.setChanged({
      filters: { from: null, to: filtersSet(query) },
      rows: { from: null, to: rows },
    });
    sendWorkbook(
      response,
      performance ? EXPORT_KINDS.STUDENT_PERFORMANCE : EXPORT_KINDS.STUDENTS,
      workbook,
    );
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<StudentDetail> {
    return this.students.detail(id);
  }

  /** Behind STUDENT_PERFORMANCE: it is the report's scope picker, not part of managing a student. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get(':id/sittings')
  sittings(
    @Param('id') id: string,
    @Query(new ZodQuery(studentSittingsQuerySchema)) query: StudentSittingsQuery,
  ): Promise<Paginated<ReportSitting>> {
    return this.students.sittings(id, query);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(@Body(new ZodBody(createStudentSchema)) body: CreateStudentBody): Promise<StudentDetail> {
    return this.students.create(body);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateStudentSchema)) body: UpdateStudentBody,
  ): Promise<StudentDetail> {
    return this.students.update(id, body);
  }

  @Audit(AUDIT_FEATURE.STUDENT, TOGGLE_ACTIONS.signIn)
  @RequiresSuperAdmin()
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentActiveSchema)) body: SetStudentActiveBody,
  ): Promise<StudentDetail> {
    return this.students.setActive(id, body.isActive);
  }

  /** An erasure request, actioned. Irreversible, and every sitting they sat is left standing. */
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.DELETE)
  @RequiresSuperAdmin()
  @Post(':id/erasure')
  @HttpCode(HttpStatus.OK)
  erase(@Param('id') id: string): Promise<ErasureReceipt> {
    return this.privacy.anonymize(id);
  }

  @Audit(AUDIT_FEATURE.STUDENT, TOGGLE_ACTIONS.tests)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/test-blocked')
  setTestBlocked(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentTestBlockedSchema)) body: SetStudentTestBlockedBody,
  ): Promise<StudentDetail> {
    return this.students.setTestBlocked(id, body.isTestBlocked);
  }
}

const canReadPerformance = (user: AuthenticatedUser) =>
  satisfiesLevel(user.permissions[FEATURE_KEYS.STUDENT_PERFORMANCE], PERMISSION_LEVELS.READ);

/** Only what was chosen: the log would otherwise carry every unset filter as a null. */
const filtersSet = (query: StudentExportQuery) =>
  Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
