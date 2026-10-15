import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth';
import { BranchesModule } from '../branches';
import { ConfigsModule } from '../configs';
import { AccessModule } from '../access';
import { NotificationsModule } from '../notifications';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentPrivacyService } from './student-privacy.service';
import { API_ROLES, onRole } from '../config/api-role';

@Module({
  // Identity documents are stored as keys; every read signs them.
  imports: [
    PrismaModule,
    StorageModule,
    AppConfigModule,
    // For the desk code: the students screen asks for one, and the code itself stays auth's.
    AuthModule,
    BranchesModule,
    ConfigsModule,
    AccessModule,
    NotificationsModule,
  ],
  controllers: onRole([API_ROLES.CORE], [StudentsController]),
  providers: [StudentsService, StudentPrivacyService],
  exports: [StudentsService, StudentPrivacyService],
})
export class StudentsModule {}
