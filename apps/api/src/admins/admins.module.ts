import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';

/**
 * Admin management and feature-level access control.
 *
 * Declares its own infra rather than assuming `app.module` provides it
 * (docs/03 §4.5). `AdminsService` is exported because `auth` needs one method
 * from it — the permission map that goes into a token — and a facade call is
 * how a module reads another's tables (docs/03 §4.2).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminsController],
  providers: [AdminsService],
  exports: [AdminsService],
})
export class AdminsModule {}
