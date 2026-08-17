import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchesModule } from '../branches';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  // BranchesModule for `assertUsable`: a group may only attach to a branch
  // that will have it, and that is the branches module's call to make.
  imports: [PrismaModule, BranchesModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
