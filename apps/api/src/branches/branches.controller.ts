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
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  ActorTypes,
  branchListQuerySchema,
  createBranchSchema,
  updateBranchSchema,
  type Branch,
  type BranchListQuery,
  type CreateBranchBody,
  type Paginated,
  type UpdateBranchBody,
} from '@iace/contracts';
import { Actors, RequiresFeature, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { BranchesService } from './branches.service';

/**
 * Branches. Reading is open to anyone who can manage groups — they have to see the list to pick
 * from it — while every write is super-admin only, which is the entire reason the table exists.
 */
@Controller('admin/branches')
@Actors(ActorTypes.ADMIN)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(branchListQuerySchema)) query: BranchListQuery,
  ): Promise<Paginated<Branch>> {
    return this.branches.list(query);
  }

  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createBranchSchema)) body: CreateBranchBody): Promise<Branch> {
    return this.branches.create(body);
  }

  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateBranchSchema)) body: UpdateBranchBody,
  ): Promise<Branch> {
    return this.branches.update(id, body);
  }

  /** Refused while any group still sits under the branch, and always for GLOBAL. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
