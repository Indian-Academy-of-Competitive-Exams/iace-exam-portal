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
  createExamSchema,
  examListQuerySchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateExamSchema,
  type CreateExamBody,
  type Exam,
  type ExamListQuery,
  type Paginated,
  type UpdateExamBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ExamsService } from './exams.service';

/**
 * The exam catalog. Reading is open to anyone who manages students — they pick from the list —
 * while every write is super-admin only, which is the entire reason the catalog exists.
 */
@Controller('admin/exams')
@Actors(ActorTypes.ADMIN)
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(@Query(new ZodQuery(examListQuerySchema)) query: ExamListQuery): Promise<Paginated<Exam>> {
    return this.exams.list(query);
  }

  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.CREATE)
  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createExamSchema)) body: CreateExamBody): Promise<Exam> {
    return this.exams.create(body);
  }

  /** The code is refused once any enrolment stores it — see `examEditBlocker`. */
  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.UPDATE)
  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateExamSchema)) body: UpdateExamBody,
  ): Promise<Exam> {
    return this.exams.update(id, body);
  }

  @Audit(AUDIT_FEATURE.EXAM_TYPE, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.exams.remove(id);
  }
}
