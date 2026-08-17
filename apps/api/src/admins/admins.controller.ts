import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  adminListQuerySchema,
  createAdminSchema,
  createFeatureSchema,
  setAdminActiveSchema,
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
  type SetAdminActiveBody,
  type StudentSyncResult,
  type UpdateAdminBody,
} from '@iace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Actors, CurrentUser, RequiresSuperAdmin } from '../common/security';
import { type AuthenticatedUser } from '../common/security';
import { AdminsService } from './admins.service';

/** Admin management, features and grants. */
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

  /** Both directions, one route — the same shape students already use. */
  @Patch('admins/:id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodBody(setAdminActiveSchema)) body: SetAdminActiveBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Admin> {
    return this.admins.setActive(id, body.isActive, user.id);
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

  /** The tuple is in the path, not a body — see the note on ADMIN_FEATURE_ROUTES. */
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
