import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { BranchesModule } from '../branches';
import { ConfigsModule } from '../configs';
import { type AccessModule } from '../access';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  // Identity documents are stored as keys; every read signs them. ConfigsModule is a cycle:
  // enrolments validate against the exam-type catalog, whose usage counts come back through here.
  imports: [
    PrismaModule,
    StorageModule,
    BranchesModule,
    forwardRef(() => ConfigsModule),
    // `require`, not a static import: `access` imports `configs`, which imports this barrel back,
    // and a top-level import here re-enters a still-loading module.
    forwardRef(
      () => (module.require('../access') as { AccessModule: typeof AccessModule }).AccessModule,
    ),
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
