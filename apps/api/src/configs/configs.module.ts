import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupsModule } from '../groups';
import { StudentsModule } from '../students';
import { ExamTypesController } from './exam-types.controller';
import { ExamTypesService } from './exam-types.service';

/** Owns `ExamType` (docs/03 §5). forwardRef: groups and students will ask it whether a code is usable. */
@Module({
  imports: [PrismaModule, forwardRef(() => GroupsModule), forwardRef(() => StudentsModule)],
  controllers: [ExamTypesController],
  providers: [ExamTypesService],
  exports: [ExamTypesService],
})
export class ConfigsModule {}
