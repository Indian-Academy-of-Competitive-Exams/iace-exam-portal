import { Controller, Get, Query } from '@nestjs/common';
import {
  ActorTypes,
  paginationQuerySchema,
  rowActionListQuerySchema,
  type ImportLogSummary,
  type Paginated,
  type PaginationQuery,
  type RowAction,
  type RowActionListQuery,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

/**
 * Always-on: no `@RequiresFeature` here. Every admin reaches these routes; the service is what
 * decides whether a given row is theirs to see.
 */
@Controller('admin/audit')
@Actors(ActorTypes.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('row-actions')
  rowActions(
    @Query(new ZodQuery(rowActionListQuerySchema)) query: RowActionListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<RowAction>> {
    return this.audit.listRowActions(query, {
      id: user.id,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
    });
  }

  @Get('imports')
  imports(
    @Query(new ZodQuery(paginationQuerySchema)) query: PaginationQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<ImportLogSummary>> {
    return this.audit.listImports(query, {
      id: user.id,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
    });
  }
}
