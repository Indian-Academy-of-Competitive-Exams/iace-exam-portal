import { Controller, Get } from '@nestjs/common';
import { ActorTypes, type StudentOverview } from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { StudentOverviewService } from './overview.service';

@Controller('me/overview')
@Actors(ActorTypes.STUDENT)
export class MeOverviewController {
  constructor(private readonly overview: StudentOverviewService) {}

  /** Their whole career as the rollup has folded it — never anybody else's. */
  @Get()
  read(@CurrentUser() user: AuthenticatedUser): Promise<StudentOverview> {
    return this.overview.overview(user.id);
  }
}
