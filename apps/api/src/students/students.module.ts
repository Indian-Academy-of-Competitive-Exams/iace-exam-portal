import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth';
import { BranchesModule } from '../branches';
import { ConfigsModule } from '../configs';
import { type AccessModule } from '../access';
import { type AttemptsModule } from '../attempts';
import { type NotificationsModule } from '../notifications';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentPrivacyService } from './student-privacy.service';
import { StudentConsentListener } from './student-consent.listener';

@Module({
  // Identity documents are stored as keys; every read signs them. ConfigsModule is a cycle:
  // enrolments validate against the exam-type catalog, whose usage counts come back through here.
  imports: [
    PrismaModule,
    StorageModule,
    AppConfigModule,
    // For the starting PIN: a student added by hand is issued one the same way a roster is.
    AuthModule,
    BranchesModule,
    forwardRef(() => ConfigsModule),
    // `require`, not a static import: `access` imports `configs`, which imports this barrel back,
    // and a top-level import here re-enters a still-loading module.
    forwardRef(
      () => (module.require('../access') as { AccessModule: typeof AccessModule }).AccessModule,
    ),
    // Same re-entry: `notifications` reads students to resolve an announcement's audience.
    forwardRef(
      () =>
        (module.require('../notifications') as { NotificationsModule: typeof NotificationsModule })
          .NotificationsModule,
    ),
    // Same re-entry, for the live standings a student's own copy of their data carries.
    forwardRef(
      () =>
        (module.require('../attempts') as { AttemptsModule: typeof AttemptsModule }).AttemptsModule,
    ),
  ],
  controllers: [StudentsController],
  providers: [StudentsService, StudentPrivacyService, StudentConsentListener],
  exports: [StudentsService, StudentPrivacyService],
})
export class StudentsModule {}
