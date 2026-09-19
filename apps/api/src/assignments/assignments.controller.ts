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
  assignmentSectionsQuerySchema,
  assignmentTestsQuerySchema,
  createAssignmentSchema,
  createSectionCommentSchema,
  mineAssignmentsQuerySchema,
  sectionProgressQuerySchema,
  type Assignment,
  type AssignableAdmin,
  type AssignableQuery,
  type AssignmentSection,
  type AssignmentSectionsQuery,
  type AssignmentTest,
  type AssignmentTestsQuery,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type CreateSectionCommentBody,
  type MineAssignmentsQuery,
  type Paginated,
  type SectionComment,
  type SectionEditLock,
  type SectionProgressQuery,
  type SectionProgressRow,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  RequiresAnyFeature,
  RequiresFeature,
  RequiresSuperAdmin,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AssignmentsService } from './assignments.service';
import { SectionThreadService } from './section-thread.service';

/** Either half of the work shares one queue — filtered by neither key alone. */
const ASSIGNEE_FEATURES = [
  FEATURE_KEYS.QUESTION_AUTHORING,
  FEATURE_KEYS.QUESTION_PROOFREAD,
] as const;

/** The thread is read from the section screen and from test builder step 2, so it takes either key. */
const THREAD_FEATURES = [...ASSIGNEE_FEATURES, FEATURE_KEYS.TEST_MANAGEMENT] as const;

/** Who types a section and who reads it. The paper itself stays owned by `tests`. */
@Controller('admin/assignments')
@Actors(ActorTypes.ADMIN)
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly thread: SectionThreadService,
  ) {}

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
  ): Promise<Paginated<AssignmentWithTest>> {
    return this.assignments.mine(user.id, query);
  }

  /** Read access over the institute's sections — assigned or not, finished or not. No actions. */
  @RequiresSuperAdmin()
  @Get('progress')
  progress(
    @Query(new ZodQuery(sectionProgressQuerySchema)) query: SectionProgressQuery,
  ): Promise<Paginated<SectionProgressRow>> {
    return this.assignments.progress(query);
  }

  /** What the queue's test picker offers. `mine` is how a super admin narrows it to their own. */
  @RequiresAnyFeature(THREAD_FEATURES, PERMISSION_LEVELS.READ)
  @Get('tests')
  tests(
    @Query(new ZodQuery(assignmentTestsQuerySchema)) query: AssignmentTestsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<AssignmentTest>> {
    return this.assignments.tests(query, user.id, user.isSuperAdmin);
  }

  @RequiresAnyFeature(THREAD_FEATURES, PERMISSION_LEVELS.READ)
  @Get('tests/:testId/sections')
  sections(
    @Param('testId') testId: string,
    @Query(new ZodQuery(assignmentSectionsQuerySchema)) query: AssignmentSectionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignmentSection[]> {
    return this.assignments.sectionChoices(testId, query, user.id, user.isSuperAdmin);
  }

  /** Read on load, never polled: it says who is in the section before the work starts. */
  @RequiresAnyFeature(THREAD_FEATURES, PERMISSION_LEVELS.READ)
  @Get('tests/:testId/sections/:sectionId/lock')
  sectionLock(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<SectionEditLock> {
    return this.assignments.sectionLock(testId, sectionId);
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
  /** The whole thread, unpaged — everyone who can see the section reads it. */
  @RequiresAnyFeature(THREAD_FEATURES, PERMISSION_LEVELS.READ)
  @Get('tests/:testId/sections/:sectionId/comments')
  comments(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<SectionComment[]> {
    return this.thread.forSection(testId, sectionId);
  }

  /** The guard only says they work here; the service says whether this section is theirs. */
  @RequiresAnyFeature(THREAD_FEATURES, PERMISSION_LEVELS.WRITE)
  @Post('tests/:testId/sections/:sectionId/comments')
  @HttpCode(HttpStatus.CREATED)
  comment(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodBody(createSectionCommentSchema)) body: CreateSectionCommentBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionComment> {
    return this.thread.comment(testId, sectionId, body, user.id, user.isSuperAdmin);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('assignable')
  assignable(
    @Query(new ZodQuery(assignableQuerySchema)) query: AssignableQuery,
  ): Promise<AssignableAdmin[]> {
    return this.assignments.assignable(query.role);
  }

  /** Last, so `mine`, `progress`, `assignable` and `tests/:testId` are never read as an assignment id. */
  @RequiresAnyFeature(ASSIGNEE_FEATURES, PERMISSION_LEVELS.READ)
  @Get(':id')
  one(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignmentWithTest> {
    return this.assignments.one(id, user.id, user.isSuperAdmin);
  }
}
