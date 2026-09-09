/**
 * Where every admin lands, whatever they hold, so the route carries no @RequiresFeature — and
 * FeaturePermissionGuard returns early when a route requires nothing, skipping its own isActive
 * check, which is why the service decides both which bands a caller gets and whether they get any.
 */
import { Controller, Get } from '@nestjs/common';
import { ActorTypes, type Dashboard } from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
@Actors(ActorTypes.ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@CurrentUser() user: AuthenticatedUser): Promise<Dashboard> {
    return this.dashboard.overview(user);
  }
}
