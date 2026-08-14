import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

/**
 * Declares its own infra rather than assuming `app.module` provides it
 * (docs/03 §4.5). The infra modules are `@Global()`, so this changes nothing at
 * runtime today — it is what makes extraction a new `main.ts` that mounts this
 * module, instead of an archaeology exercise in what it silently depended on.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
