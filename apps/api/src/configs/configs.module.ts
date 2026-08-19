import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { type GroupsModule } from '../groups';
import { type StudentsModule } from '../students';
import { ExamTypesController } from './exam-types.controller';
import { ExamTypesService } from './exam-types.service';

/** Owns `ExamType` (docs/03 §5). forwardRef: groups and students will ask it whether a code is usable. */
@Module({
  imports: [
    PrismaModule,
    // `require`, not a static import: a top-level import here re-enters the still-loading `groups`
    // barrel and throws; a CommonJS `require` tolerates the partial circular load instead.
    forwardRef(
      () => (module.require('../groups') as { GroupsModule: typeof GroupsModule }).GroupsModule,
    ),
    // Same reason as `groups` above: `students` now imports this module for `assertUsable`.
    forwardRef(
      () =>
        (module.require('../students') as { StudentsModule: typeof StudentsModule }).StudentsModule,
    ),
  ],
  controllers: [ExamTypesController],
  providers: [ExamTypesService],
  exports: [ExamTypesService],
})
export class ConfigsModule {}
