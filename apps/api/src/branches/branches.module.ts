import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [PrismaModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
