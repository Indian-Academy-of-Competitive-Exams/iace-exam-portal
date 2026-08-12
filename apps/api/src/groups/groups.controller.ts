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
  addGroupMembersSchema,
  createGroupSchema,
  groupListQuerySchema,
  updateGroupSchema,
  type AddGroupMembersBody,
  type AddGroupMembersResult,
  type CreateGroupBody,
  type GroupListQuery,
  type GroupSummary,
  type Paginated,
  type UpdateGroupBody,
} from '@iace/contracts';
import { Actors, RequiresPage } from '../auth/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { GroupsService } from './groups.service';

/**
 * Groups. Members are READ through `/admin/students?groupId=…`, which already
 * pages, searches and filters — a second member-list endpoint would be the same
 * query with its own bugs.
 */
@Controller('admin/groups')
@Actors(ActorTypes.ADMIN)
@RequiresPage(ADMIN_PAGES.GROUPS_MANAGE)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(
    @Query(new ZodQuery(groupListQuerySchema)) query: GroupListQuery,
  ): Promise<Paginated<GroupSummary>> {
    return this.groups.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<GroupSummary> {
    return this.groups.detail(id);
  }

  @Post()
  create(@Body(new ZodBody(createGroupSchema)) body: CreateGroupBody): Promise<GroupSummary> {
    return this.groups.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateGroupSchema)) body: UpdateGroupBody,
  ): Promise<GroupSummary> {
    return this.groups.update(id, body);
  }

  /** Refused while anything still depends on the group. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<void> {
    return this.groups.remove(id);
  }

  @Post(':id/students')
  @HttpCode(HttpStatus.OK)
  addMembers(
    @Param('id') id: string,
    @Body(new ZodBody(addGroupMembersSchema)) body: AddGroupMembersBody,
  ): Promise<AddGroupMembersResult> {
    return this.groups.addMembers(id, body.studentIds);
  }

  @Delete(':id/students/:studentId')
  @HttpCode(HttpStatus.OK)
  removeMember(@Param('id') id: string, @Param('studentId') studentId: string): Promise<void> {
    return this.groups.removeMember(id, studentId);
  }
}
