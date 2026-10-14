import { Module } from '@nestjs/common';
import { AccessModule } from '../access';
import { AttemptsModule } from '../attempts';
import { AuditModule } from '../audit';
import { API_ROLES, onRole } from '../config/api-role';
import { NotificationsModule } from '../notifications';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { QuestionsModule } from '../questions';
import { ReportsModule } from '../reports';
import { StudentsModule } from '../students';
import { ExportBuilders } from './export-builders';
import { ExportsController } from './exports.controller';
import { ExportsProcessor } from './exports.processor';

/** Aggregates every module that lends a file, as `me` aggregates what a student reads (docs/03 §4). */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AuditModule,
    AccessModule,
    AttemptsModule,
    NotificationsModule,
    QuestionsModule,
    ReportsModule,
    StudentsModule,
  ],
  controllers: onRole([API_ROLES.CORE], [ExportsController]),
  providers: [ExportBuilders, ...onRole([API_ROLES.WORKER], [ExportsProcessor])],
})
export class ExportsModule {}
