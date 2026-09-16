import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DOCUMENT_MAX_BYTES } from '@iace/contracts';
import { AuthModule } from '../auth';
import { StorageModule } from '../storage/storage.module';
import { StudentsModule } from '../students';
import { AccessModule } from '../access';
import { NotificationsModule } from '../notifications';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  // StudentsModule for the read/update path — the flags it recomputes are the
  // reason this does not have its own. AuthModule for the PIN and sessions.
  imports: [
    AuthModule,
    StudentsModule,
    AccessModule,
    NotificationsModule,
    StorageModule,
    // The ceiling is applied while the body arrives, not after multer has
    // buffered the whole thing — see imports.module.ts for why that matters.
    MulterModule.register({ limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }),
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
