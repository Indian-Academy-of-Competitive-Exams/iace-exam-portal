import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [PrismaModule],
  controllers: onRole([API_ROLES.CORE], [DashboardController]),
  providers: [DashboardService],
})
export class DashboardModule {}
