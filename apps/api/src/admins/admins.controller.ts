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
  adminListQuerySchema,
  createAdminSchema,
  createFeatureSchema,
  featureKeySchema,
  permissionGrantSchema,
  permissionLevelSchema,
  updateAdminSchema,
  type Admin,
  type AdminListQuery,
  type Paginated,
  type CreateAdminBody,
  type Feature,
  type PermissionGrantBody,
  type StudentSyncResult,
  type UpdateAdminBody,
} from '@iace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Actors, CurrentUser, RequiresSuperAdmin } from '../common/security';
import { type AuthenticatedUser } from '../common/security';
import { AdminsService } from './admins.service';

/**
 * Admin management, features and grants.
 *
 * Every route is `@RequiresSuperAdmin`, at the class level, deliberately: this
 * is the controller that decides who can do what, and gating it on a feature
 * permission would mean the permission system could be used to grant control of
 * itself. There is no feature key for this screen and there should not be one.
 *
 * The one thing that is NOT here is an admin reading their own permissions —
 * that lives on the `me`/auth surface, because it is a fact about the caller
 * rather than an administrative action.
 */
@Controller('admin')
@Actors(ActorTypes.ADMIN)
@RequiresSuperAdmin()
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get('admins')
  list(
    @Query(new ZodQuery(adminListQuerySchema)) query: AdminListQuery,
  ): Promise<Paginated<Admin>> {
    return this.admins.list(query);
  }

  @Post('admins')
  create(
    @Body(new ZodBody(createAdminSchema)) body: CreateAdminBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Admin> {
    // createdById is taken from the token, never the body — an audit field a
    // caller can set is not an audit field.
    return this.admins.create(body, user.id);
  }

  @Patch('admins/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateAdminSchema)) body: UpdateAdminBody,
  ): Promise<Admin> {
    return this.admins.update(id, body);
  }

  /**
   * 200, not 204. Every response in this API is an envelope, and a 204 carries
   * no body — so the client would read empty text where it expects
   * `{ success, data: null, meta }` and fail with "unexpected response shape".
   * Same reason `branches.remove` is an explicit OK.
   */
  @Delete('admins/:id')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.admins.deactivate(id, user.id);
  }

  @Get('features')
  listFeatures(): Promise<Feature[]> {
    return this.admins.listFeatures();
  }

  @Post('features')
  createFeature(
    @Body(new ZodBody(createFeatureSchema)) body: { key: string; description?: string },
  ): Promise<Feature> {
    return this.admins.createFeature(body);
  }

  @Post('features/permissions')
  grant(@Body(new ZodBody(permissionGrantSchema)) body: PermissionGrantBody): Promise<Feature> {
    return this.admins.grant(body);
  }

  /**
   * The tuple is in the path, not a body — see the note on ADMIN_FEATURE_ROUTES.
   * Both params are parsed against their enums rather than trusted: they arrive
   * as strings from a URL, and an unparsed one would reach Prisma as a level it
   * has no row for.
   */
  @Delete('features/:featureKey/permissions/:level/:adminId')
  revoke(
    @Param('featureKey') featureKey: string,
    @Param('level') level: string,
    @Param('adminId') adminId: string,
  ): Promise<Feature> {
    return this.admins.revoke({
      featureKey: featureKeySchema.parse(featureKey),
      level: permissionLevelSchema.parse(level),
      adminId,
    });
  }

  /** Stubbed service body; the plumbing around it is finished. */
  @Post('sync/students')
  @HttpCode(200)
  syncStudents(): Promise<StudentSyncResult> {
    return this.admins.triggerStudentSync();
  }
}
