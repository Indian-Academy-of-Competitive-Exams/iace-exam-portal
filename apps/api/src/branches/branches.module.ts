import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { type AccessModule } from '../access';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [
    PrismaModule,
    // A new branch has to appear on every series' scheduling screen, and `access` reaches back
    // here through students — so the cycle is broken with a `require` rather than an import.
    forwardRef(
      () => (module.require('../access') as { AccessModule: typeof AccessModule }).AccessModule,
    ),
  ],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
