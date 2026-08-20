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
  baseConfigListQuerySchema,
  cloneBaseConfigSchema,
  createBaseConfigSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateBaseConfigSchema,
  type BaseConfig,
  type BaseConfigDetail,
  type BaseConfigListQuery,
  type CloneBaseConfigBody,
  type CreateBaseConfigBody,
  type Paginated,
  type UpdateBaseConfigBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { BaseConfigsService } from './base-configs.service';

/** A stage's blueprints. Gated on TEST_MANAGEMENT — a config is the shape every test inherits. */
@Controller('admin/base-configs')
@Actors(ActorTypes.ADMIN)
export class BaseConfigsController {
  constructor(private readonly configs: BaseConfigsService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(baseConfigListQuerySchema)) query: BaseConfigListQuery,
  ): Promise<Paginated<BaseConfig>> {
    return this.configs.list(query);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<BaseConfigDetail> {
    return this.configs.detail(id);
  }

  @Audit(AUDIT_FEATURE.BASE_CONFIG, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Body(new ZodBody(createBaseConfigSchema)) body: CreateBaseConfigBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BaseConfigDetail> {
    return this.configs.create(body, user.id);
  }

  /** Refused once the config is locked, name/default/active excepted — see `locksOutEdit`. */
  @Audit(AUDIT_FEATURE.BASE_CONFIG, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateBaseConfigSchema)) body: UpdateBaseConfigBody,
  ): Promise<BaseConfigDetail> {
    return this.configs.update(id, body);
  }

  /** How a locked config evolves: the whole paper, copied, unlocked, pointing back at its origin. */
  @Audit(AUDIT_FEATURE.BASE_CONFIG, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/clone')
  @HttpCode(HttpStatus.OK)
  clone(
    @Param('id') id: string,
    @Body(new ZodBody(cloneBaseConfigSchema)) body: CloneBaseConfigBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BaseConfigDetail> {
    return this.configs.clone(id, body, user.id);
  }

  @Audit(AUDIT_FEATURE.BASE_CONFIG, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<void> {
    return this.configs.remove(id);
  }
}
