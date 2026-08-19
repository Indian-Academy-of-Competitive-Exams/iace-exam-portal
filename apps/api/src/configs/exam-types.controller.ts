import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createExamTypeSchema,
  examTypeListQuerySchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateExamTypeSchema,
  type CreateExamTypeBody,
  type ExamType,
  type ExamTypeListQuery,
  type Paginated,
  type UpdateExamTypeBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ExamTypesService } from './exam-types.service';

/**
 * Exam types. Reading is open to anyone who can manage groups — they pick from the list — while
 * every write is super-admin only, which is the entire reason the catalog exists.
 */
@Controller('admin/exam-types')
@Actors(ActorTypes.ADMIN)
export class ExamTypesController {
  constructor(private readonly examTypes: ExamTypesService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(examTypeListQuerySchema)) query: ExamTypeListQuery,
  ): Promise<Paginated<ExamType>> {
    return this.examTypes.list(query);
  }

  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.CREATE)
  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createExamTypeSchema)) body: CreateExamTypeBody): Promise<ExamType> {
    return this.examTypes.create(body);
  }

  /** The code is refused once any group or enrolment stores it — see `examTypeEditBlocker`. */
  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.UPDATE)
  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateExamTypeSchema)) body: UpdateExamTypeBody,
  ): Promise<ExamType> {
    return this.examTypes.update(id, body);
  }

  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.examTypes.remove(id);
  }
}
