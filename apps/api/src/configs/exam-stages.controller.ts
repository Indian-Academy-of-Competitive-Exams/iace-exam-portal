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
  createExamStageSchema,
  examStageListQuerySchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateExamStageSchema,
  type CreateExamStageBody,
  type ExamStage,
  type ExamStageListQuery,
  type Paginated,
  type UpdateExamStageBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ExamStagesService } from './exam-stages.service';

/**
 * The stage layer of the catalog. Read by whoever builds a config or a test — they pick from the
 * list — while every write is super-admin only, exactly as the exam above it.
 */
@Controller('admin/exam-stages')
@Actors(ActorTypes.ADMIN)
export class ExamStagesController {
  constructor(private readonly stages: ExamStagesService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(examStageListQuerySchema)) query: ExamStageListQuery,
  ): Promise<Paginated<ExamStage>> {
    return this.stages.list(query);
  }

  @Audit(AUDIT_FEATURE.EXAM_TAXONOMY, AUDIT_ACTION.CREATE)
  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createExamStageSchema)) body: CreateExamStageBody): Promise<ExamStage> {
    return this.stages.create(body);
  }

  /** The key is refused once a base config hangs off it — see `stageEditBlocker`. */
  @Audit(AUDIT_FEATURE.EXAM_TAXONOMY, AUDIT_ACTION.UPDATE)
  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateExamStageSchema)) body: UpdateExamStageBody,
  ): Promise<ExamStage> {
    return this.stages.update(id, body);
  }

  @Audit(AUDIT_FEATURE.EXAM_TAXONOMY, AUDIT_ACTION.DELETE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.stages.remove(id);
  }
}
