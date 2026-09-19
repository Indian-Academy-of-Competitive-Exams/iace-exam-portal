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
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  assignableQuerySchema,
  createAssignmentSchema,
  mineAssignmentsQuerySchema,
  type Assignment,
  type AssignableAdmin,
  type AssignableQuery,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type MineAssignmentsQuery,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  RequiresAnyFeature,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AssignmentsService } from './assignments.service';

/** Either half of the work shares one queue — filtered by neither key alone. */
const ASSIGNEE_FEATURES = [
  FEATURE_KEYS.QUESTION_AUTHORING,
  FEATURE_KEYS.QUESTION_PROOFREAD,
] as const;

/** Who types a section and who reads it. The paper itself stays owned by `tests`. */
@Controller('admin/assignments')
@Actors(ActorTypes.ADMIN)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('tests/:testId')
  forTest(@Param('testId') testId: string): Promise<Assignment[]> {
    return this.assignments.forTest(testId);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('tests/:testId')
  @HttpCode(HttpStatus.CREATED)
  assign(
    @Param('testId') testId: string,
    @Body(new ZodBody(createAssignmentSchema)) body: CreateAssignmentBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Assignment> {
    return this.assignments.assign(testId, body, user.id);
  }

  @RequiresAnyFeature(ASSIGNEE_FEATURES, PERMISSION_LEVELS.READ)
  @Get('mine')
  mine(
    @Query(new ZodQuery(mineAssignmentsQuerySchema)) query: MineAssignmentsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignmentWithTest[]> {
    return this.assignments.mine(user.id, query);
  }

  /** Either role finalises their own row — "I've written this" and "I've read this" are independent. */
  @RequiresAnyFeature(ASSIGNEE_FEATURES, PERMISSION_LEVELS.WRITE)
  @Patch(':id/finalize')
  finalize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Assignment> {
    return this.assignments.finalize(id, user.id, user.isSuperAdmin);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.assignments.remove(id);
  }

  /** Who a role can be given to — the same key `assign` itself requires, never the admin directory. */
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('assignable')
  assignable(
    @Query(new ZodQuery(assignableQuerySchema)) query: AssignableQuery,
  ): Promise<AssignableAdmin[]> {
    return this.assignments.assignable(query.role);
  }
}
