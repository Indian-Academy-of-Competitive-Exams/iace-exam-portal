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
  ADMIN_PAGES,
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
import { Actors, RequiresPage, RequiresSuperAdmin } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { BranchesService } from './branches.service';

/**
 * Branches. Reading is open to anyone who can manage groups — they have to see
 * the list to pick from it — while every write is super-admin only, which is
 * the entire reason the table exists.
 */
@Controller('admin/branches')
@Actors(ActorTypes.ADMIN)
@RequiresPage(ADMIN_PAGES.GROUPS_MANAGE)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

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
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
