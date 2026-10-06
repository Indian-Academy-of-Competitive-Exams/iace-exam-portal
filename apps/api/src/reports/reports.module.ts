import { Module } from '@nestjs/common';
import { AccessModule } from '../access';
import { AttemptsModule } from '../attempts';
import { API_ROLES, onRole } from '../config/api-role';
import { PrismaModule } from '../prisma/prisma.module';
import { MeReportsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [PrismaModule, AttemptsModule, AccessModule],
  controllers: onRole([API_ROLES.CORE], [ReportsController, MeReportsController]),
  providers: [ReportsService],
})
export class ReportsModule {}
