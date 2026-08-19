import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditContext } from './audit.context';
import { AuditListener } from './audit.listener';
import { AuditService } from './audit.service';

/** Global: every feature module contributes a diff, and none should have to import this. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService, AuditListener, AuditContext],
  exports: [AuditService, AuditContext],
})
export class AuditModule {}
