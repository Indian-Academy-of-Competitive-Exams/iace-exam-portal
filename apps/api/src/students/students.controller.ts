import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AUDIT_FEATURE,
  AUDIT_ACTION,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  ActorTypes,
  createStudentSchema,
  setStudentActiveSchema,
  setStudentTestBlockedSchema,
  studentListQuerySchema,
  studentSittingsQuerySchema,
  updateStudentSchema,
  type CreateStudentBody,
  type ErasureReceipt,
  type Paginated,
  type PaginationQuery,
  type SetStudentActiveBody,
  type ShareableSitting,
  type SetStudentTestBlockedBody,
  type StudentDetail,
  type StudentListQuery,
  type StudentSummary,
  type UpdateStudentBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit, TOGGLE_ACTIONS } from '../audit';
import { StudentsService } from './students.service';
import { StudentPrivacyService } from './student-privacy.service';

/**
 * The admin-side student directory. `@Actors(ADMIN)` is the hard boundary — a student's
 * token is a valid JWT and must not reach here. `@RequiresFeature` is per route: read vs write.
 */
@Controller('admin/students')
@Actors(ActorTypes.ADMIN)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly privacy: StudentPrivacyService,
  ) {}

  /** Returns the list shape the response interceptor splits into data + meta. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(studentListQuerySchema)) query: StudentListQuery,
  ): Promise<Paginated<StudentSummary>> {
    return this.students.list(query);
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
    @Query(new ZodQuery(studentSittingsQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<ShareableSitting>> {
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
